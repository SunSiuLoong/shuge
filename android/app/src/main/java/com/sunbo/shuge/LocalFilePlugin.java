package com.sunbo.shuge;

import android.content.Intent;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Base64;

/**
 * 引用模式导入（静读天下式「不复制」）的安卓侧。
 *
 * 流程：
 * 1. pick() 拉起系统文件选择器（SAF，ACTION_OPEN_DOCUMENT，可多选），
 *    对选中的 uri takePersistableUriPermission——重启后仍可读，不占书库空间；
 * 2. JS 侧拿着 content:// uri 调 readChunk() 分块读进内存拼成 File，
 *    去重/解析/打开都在内存里走，原文件始终留在原处。
 *
 * SAF 不需要任何 manifest 权限；用户在系统选择器里授权，App 只拿读权限。
 */
@CapacitorPlugin(name = "ShugeLocalFile")
public class LocalFilePlugin extends Plugin {

    private ActivityResultLauncher<Intent> pickLauncher;
    private String pendingPickCallId;

    @Override
    public void load() {
        pickLauncher = bridge.getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::onPickResult);
    }

    /** 拉起系统选择器，多选 EPUB。MIME 给 *//*：很多文件管理器不给 epub 正确的 MIME。 */
    @PluginMethod
    public void pick(PluginCall call) {
        if (pendingPickCallId != null) {
            PluginCall stale = bridge.getSavedCall(pendingPickCallId);
            if (stale != null) stale.resolve(new JSObject()); // 上次没等到结果就再点：先放掉
        }
        pendingPickCallId = call.getCallbackId();
        saveCall(call);

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
            new String[]{"application/epub+zip", "application/octet-stream"});
        pickLauncher.launch(intent);
    }

    private void onPickResult(ActivityResult result) {
        PluginCall call = pendingPickCallId != null
            ? bridge.getSavedCall(pendingPickCallId) : null;
        pendingPickCallId = null;
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK) {
            call.resolve(new JSObject()); // 用户取消：空列表
            return;
        }
        Intent data = result.getData();
        JSArray files = new JSArray();
        ArrayList<Uri> uris = new ArrayList<>();
        if (data != null && data.getData() != null) {
            uris.add(data.getData());
        } else if (data != null && data.getClipData() != null) {
            int n = data.getClipData().getItemCount();
            for (int i = 0; i < n; i++) uris.add(data.getClipData().getItemAt(i).getUri());
        }
        for (Uri uri : uris) {
            // 持久授权：不加这两行，重启后 uri 就读不了
            try {
                bridge.getContext().getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // 提供方没给 persistable flag：本次会话内仍可读，重启后需重选
            }
            JSObject f = new JSObject();
            f.put("uri", uri.toString());
            f.put("name", displayName(uri));
            f.put("size", sizeOf(uri));
            files.put(f);
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor c = bridge.getContext().getContentResolver()
                .query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String name = c.getString(i);
                    if (name != null) return name;
                }
            }
        } catch (Exception ignored) { }
        return uri.getLastPathSegment();
    }

    private long sizeOf(Uri uri) {
        try (android.database.Cursor c = bridge.getContext().getContentResolver()
                .query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !c.isNull(i)) return c.getLong(i);
            }
        } catch (Exception ignored) { }
        return 0;
    }

    /**
     * 分块读：offset 用 ParcelFileDescriptor.seek，大文件 skip 也不拖慢。
     * base64 走标准 java.util.Base64（API 26+）。
     */
    @PluginMethod
    public void readChunk(PluginCall call) {
        String uriStr = call.getString("uri");
        long offset = call.getDouble("offset", 0.0) != null
            ? (long) (double) call.getDouble("offset", 0.0) : 0L;
        int length = call.getInt("length", 2 * 1024 * 1024);
        if (uriStr == null) {
            call.reject("uri missing");
            return;
        }
        try {
            Uri uri = Uri.parse(uriStr);
            ParcelFileDescriptor pfd = bridge.getContext().getContentResolver()
                .openFileDescriptor(uri, "r");
            if (pfd == null) {
                call.reject("cannot open");
                return;
            }
            try (ParcelFileDescriptor p = pfd;
                 FileInputStream in = new FileInputStream(p.getFileDescriptor())) {
                long skipped = in.skip(offset);
                // InputStream.skip 不保证一次读完，兜底循环
                while (skipped < offset) {
                    long s = in.skip(offset - skipped);
                    if (s <= 0) break;
                    skipped += s;
                }
                byte[] buf = new byte[length];
                int n = 0, r;
                while (n < length && (r = in.read(buf, n, length - n)) != -1) n += r;
                JSObject ret = new JSObject();
                ret.put("base64", n > 0
                    ? Base64.getEncoder().encodeToString(
                        n == buf.length ? buf : java.util.Arrays.copyOf(buf, n))
                    : "");
                ret.put("eof", n < length);
                call.resolve(ret);
            }
        } catch (SecurityException e) {
            call.reject("没有原文件的读取权限，请重新导入", e);
        } catch (Exception e) {
            call.reject("读取失败：" + e.getMessage(), e);
        }
    }
}
