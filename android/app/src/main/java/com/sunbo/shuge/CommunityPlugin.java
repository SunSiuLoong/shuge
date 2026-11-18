package com.sunbo.shuge;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 社区（阡陌居 Discuz）的 HTTP 桥与附件下载。
 *
 * 为什么不走 WebView fetch：App 源是 capacitor://localhost，跨源请求会被
 * CORS 拦死，拿不到论坛页面。这里原生 HttpURLConnection 直连，并手动带上
 * CookieManager 里的 WebView Cookie——用户在内置浏览器登录过一次，
 * 之后签到/领任务/搜索都自动带着登录态。
 */
@CapacitorPlugin(name = "CommunityHttp")
public class CommunityPlugin extends Plugin {

    private static final int TIMEOUT_MS = 15000;
    private static final int MAX_BODY = 2 * 1024 * 1024;

    /** 先在 UI 线程拿 Cookie（CookieManager 要求），再开线程跑网络 */
    private void requestOnUiThread(PluginCall call, String cookieHolderUrl, HttpRunnable task) {
        getActivity().runOnUiThread(() -> {
            String cookie = CookieManager.getInstance().getCookie(cookieHolderUrl);
            new Thread(() -> task.run(cookie)).start();
        });
    }

    interface HttpRunnable {
        void run(String cookie);
    }

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        String contentType = call.getString("contentType", "application/x-www-form-urlencoded");
        if (url == null || !url.startsWith("https://")) {
            call.reject("bad url");
            return;
        }
        requestOnUiThread(call, url, (cookie) -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(TIMEOUT_MS);
                conn.setReadTimeout(TIMEOUT_MS);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Mobile Safari/537.36");
                conn.setRequestProperty("Referer", "https://www.1000qm.vip/");
                if (cookie != null && !cookie.isEmpty()) {
                    conn.setRequestProperty("Cookie", cookie);
                }
                if ("POST".equals(method)) {
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", contentType);
                    if (body != null) {
                        conn.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
                    }
                } else {
                    conn.setRequestMethod("GET");
                }
                int status = conn.getResponseCode();
                String finalUrl = conn.getURL().toString();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] chunk = new byte[8192];
                    int n;
                    int total = 0;
                    while ((n = in.read(chunk)) > 0 && total < MAX_BODY) {
                        buf.write(chunk, 0, n);
                        total += n;
                    }
                    in.close();
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("url", finalUrl);
                ret.put("body", new String(buf.toByteArray(), StandardCharsets.UTF_8));
                // 临时诊断：CookieManager 有没有读到这个域的 Cookie
                ret.put("hasCookie", cookie != null && !cookie.isEmpty());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("request failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /**
     * 附件下载交给系统 DownloadManager：带 WebView Cookie（登录后才能下的
     * 附件也能下），下载完成在系统通知栏可见。
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "attachment");
        if (url == null || !url.startsWith("https://")) {
            call.reject("bad url");
            return;
        }
        // 文件名来自网页链接，可能带路径分隔符或 ..：只留最后一段并剔除非法字符，
        // 否则 setDestinationInExternalPublicDir 会抛异常或写到 Downloads 之外。
        name = sanitizeName(name);
        final String fileName = name;
        getActivity().runOnUiThread(() -> {
            try {
                String cookie = CookieManager.getInstance().getCookie(url);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setTitle(fileName);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                if (cookie != null && !cookie.isEmpty()) {
                    req.addRequestHeader("Cookie", cookie);
                }
                req.addRequestHeader("Referer", "https://www.1000qm.vip/");
                DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(req);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("download failed: " + e.getMessage());
            }
        });
    }

    /** 去掉路径分隔符、控制字符与 ..，并保留扩展名 */
    private static String sanitizeName(String raw) {
        String base = raw == null ? "" : raw;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0) base = base.substring(slash + 1);
        base = base.replaceAll("[\\p{Cntrl}\"*?<>|:]", "_").replace("..", "_").trim();
        if (base.isEmpty()) base = "attachment";
        if (base.length() > 120) {
            int dot = base.lastIndexOf('.');
            String ext = dot > 0 ? base.substring(dot) : "";
            base = base.substring(0, Math.max(1, 120 - ext.length())) + ext;
        }
        return base;
    }
}
