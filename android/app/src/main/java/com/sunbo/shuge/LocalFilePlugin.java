package com.sunbo.shuge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.provider.DocumentsContract;
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
    /**
     * 挂起的调用直接用字段持有，不走 bridge.getSavedCall()。
     * 实测（OPPO ColorOS 选择器）：App 被切到后台再回来，Bridge 里的
     * savedCalls 已被清空，getSavedCall 返回 null，Promise 就永远悬着。
     * 插件实例本身的字段活得比 savedCalls 久（同一次进程内不会重建）。
     */
    private PluginCall pendingPickCall;

    /** 手机存储文件夹扫描（书架搜索的「本地」档） */
    private ActivityResultLauncher<Intent> folderLauncher;
    private PluginCall pendingScanCall;
    private static final String PREFS = "shuge_local";
    private static final String KEY_TREE = "scan_tree_uri";
    /** 扫描上限：再大的目录也不至于把 bridge 拖死；超出的部分用户可换个更小的文件夹 */
    private static final int MAX_FILES = 800;
    private static final int MAX_DEPTH = 6;
    private static final String[] BOOK_EXT = {
        ".epub", ".pdf", ".mobi", ".azw3", ".azw", ".fb2", ".cbz", ".txt"
    };

    @Override
    public void load() {
        pickLauncher = bridge.getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::onPickResult);
        folderLauncher = bridge.getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::onFolderResult);
    }

    private SharedPreferences prefs() {
        return bridge.getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 拉起系统选择器，多选 EPUB。MIME 给 *//*：很多文件管理器不给 epub 正确的 MIME。 */
    @PluginMethod
    public void pick(PluginCall call) {
        if (pendingPickCall != null) {
            pendingPickCall.resolve(new JSObject()); // 上次没等到结果就再点：先放掉
        }
        pendingPickCall = call;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
            new String[]{"application/epub+zip", "application/octet-stream"});
        pickLauncher.launch(intent);
    }

    private void onPickResult(ActivityResult result) {
        PluginCall call = pendingPickCall;
        pendingPickCall = null;
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

    /* ============ 手机存储文件夹扫描 ============
     * 书架搜索的「本地」档：让用户在系统选择器里指定一个文件夹（SAF 目录授权），
     * 拿到持久读权限后递归列出里面的电子书。全程不需要存储权限，
     * 也不读文件夹以外的任何位置。
     *
     * 没授权过 → 拉起目录选择器；授权过 → 直接重扫（换文件夹走 forgetFolder）。 */

    @PluginMethod
    public void scan(PluginCall call) {
        Log.d("ShugeScan", "scan() called, saved=" + prefs().getString(KEY_TREE, null));
        String saved = prefs().getString(KEY_TREE, null);
        if (saved != null) {
            runScan(call, Uri.parse(saved));
            return;
        }
        if (pendingScanCall != null) {
            pendingScanCall.resolve(new JSObject());
        }
        pendingScanCall = call;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        folderLauncher.launch(intent);
    }

    /** 忘掉授权过的文件夹，下次 scan 重新弹选择器 */
    @PluginMethod
    public void forgetFolder(PluginCall call) {
        prefs().edit().remove(KEY_TREE).apply();
        call.resolve(new JSObject());
    }

    /** 是否已有保存的目录授权。前端自动导入前先问这一句，避免 scan() 误弹选择器 */
    @PluginMethod
    public void hasFolder(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("has", prefs().getString(KEY_TREE, null) != null);
        call.resolve(ret);
    }

    private void onFolderResult(ActivityResult result) {
        Log.d("ShugeScan", "onFolderResult rc=" + result.getResultCode()
            + " data=" + (result.getData() == null ? "null" : String.valueOf(result.getData().getData())));
        PluginCall call = pendingScanCall;
        pendingScanCall = null;
        if (call == null) {
            Log.d("ShugeScan", "onFolderResult: 没有挂起的调用（进程被杀过？）");
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK
            || data == null || data.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            ret.put("files", new JSArray());
            call.resolve(ret);
            return;
        }
        Uri tree = data.getData();
        try {
            bridge.getContext().getContentResolver().takePersistableUriPermission(
                tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            prefs().edit().putString(KEY_TREE, tree.toString()).apply();
        } catch (SecurityException ignored) {
            // 拿不到持久授权：本次能扫，重启后要重新选
        }
        runScan(call, tree);
    }

    /** 递归列出树里的电子书（后台线程，最多 MAX_FILES 本 / MAX_DEPTH 层） */
    private void runScan(PluginCall call, Uri treeUri) {
        final String folder = folderLabel(treeUri);
        new Thread(() -> {
            JSArray files = new JSArray();
            try {
                String rootId = DocumentsContract.getTreeDocumentId(treeUri);
                walk(treeUri, rootId, "", 0, files);
            } catch (Exception ignored) {
                // 授权过期 / 提供方不支持：返回空列表，前端提示重新选文件夹
            }
            Log.d("ShugeScan", "runScan done folder=" + folder + " files=" + files.length());
            JSObject ret = new JSObject();
            ret.put("folder", folder);
            ret.put("files", files);
            bridge.getActivity().runOnUiThread(() -> call.resolve(ret));
        }, "shuge-scan").start();
    }

    private void walk(Uri treeUri, String parentDocId, String dir, int depth, JSArray out) {
        if (depth > MAX_DEPTH || out.length() >= MAX_FILES) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        String[] proj = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        };
        try (Cursor c = bridge.getContext().getContentResolver()
                .query(children, proj, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext() && out.length() < MAX_FILES) {
                String id = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                if (name == null) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walk(treeUri, id, dir.isEmpty() ? name : dir + "/" + name, depth + 1, out);
                } else if (isBookName(name)) {
                    JSObject f = new JSObject();
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString());
                    f.put("name", name);
                    f.put("size", c.isNull(3) ? 0L : c.getLong(3));
                    f.put("dir", dir);
                    out.put(f);
                }
            }
        } catch (Exception ignored) {
            // 某个子目录读不了就跳过，不影响其它目录
        }
    }

    private boolean isBookName(String name) {
        String lower = name.toLowerCase();
        for (String ext : BOOK_EXT) {
            if (lower.endsWith(ext)) return true;
        }
        return false;
    }

    /** 目录树 id 形如 primary:Books/小说，取冒号后的相对路径当标题 */
    private String folderLabel(Uri treeUri) {
        try {
            String id = DocumentsContract.getTreeDocumentId(treeUri);
            int i = id.indexOf(':');
            String path = i >= 0 ? id.substring(i + 1) : id;
            return path.isEmpty() ? "手机存储" : path;
        } catch (Exception e) {
            return "手机存储";
        }
    }
}
