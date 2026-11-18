package com.sunbo.shuge;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * App 内置浏览器：整屏 WebView + 一条自绘工具栏。
 *
 * 为什么不直接用 @capacitor/browser（Chrome Custom Tabs）：
 * Custom Tabs 用的是系统浏览器的 Cookie，跟 App 自己的 WebView Cookie 是两套；
 * 用户在 Custom Tabs 里登录了阡陌居，CommunityPlugin 从 CookieManager 读不到登录态，
 * 签到/领任务就会一直报「未登录」。这里用同一个 WebView，Cookie 天然共享。
 *
 * 版面全部代码里拼，不引 layout 资源，避免跟 cap sync 生成的资源打架。
 */
public class InAppWebActivity extends AppCompatActivity {

    private WebView web;
    private ProgressBar bar;
    private TextView titleView;
    private String fallbackTitle = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent it = getIntent();
        String url = it.getStringExtra("url");
        fallbackTitle = it.getStringExtra("title") == null ? "" : it.getStringExtra("title");
        int bg = parseColor(it.getStringExtra("bg"), 0xFFFBF9F4);
        int fg = parseColor(it.getStringExtra("fg"), 0xFF1A1A1A);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);
        root.setFitsSystemWindows(true);

        // ---- 工具栏 ----
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(4), dp(6), dp(4), dp(6));
        header.setBackgroundColor(bg);

        header.addView(barButton("\u2190", "返回", fg, v -> onBackPressed()));

        titleView = new TextView(this);
        titleView.setText(fallbackTitle);
        titleView.setTextColor(fg);
        titleView.setTextSize(16f);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titleView.setPadding(dp(6), 0, dp(6), 0);
        titleView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams tp =
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(titleView, tp);

        header.addView(barButton("\u27F3", "刷新", fg, v -> web.reload()));
        header.addView(barButton("\u2197", "在浏览器中打开", fg, v -> openOutside()));
        header.addView(barButton("\u2715", "关闭", fg, v -> finish()));
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ---- 进度条 ----
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(0);
        LinearLayout.LayoutParams bp =
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2));
        root.addView(bar, bp);

        // ---- WebView ----
        FrameLayout holder = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(bg);
        holder.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams hp =
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(holder, hp);

        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // 站点一律按手机版渲染；多窗口关掉，target=_blank 就在本 WebView 里开
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String u) {
                return handleScheme(u);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                if (bar == null) return;
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (title != null && !title.isEmpty() && titleView != null) {
                    titleView.setText(title);
                }
            }
        });

        if (url != null && !url.isEmpty()) web.loadUrl(url);
    }

    /** 非 http(s) 的 scheme（intent://、mailto:、tg: 等）交给系统，其余在本 WebView 里加载 */
    private boolean handleScheme(String u) {
        if (u == null) return false;
        if (u.startsWith("http://") || u.startsWith("https://")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        } catch (ActivityNotFoundException ignored) {
            // 没有能接这个 scheme 的应用，安静吞掉
        }
        return true;
    }

    private void openOutside() {
        String u = web.getUrl();
        if (u == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private TextView barButton(String glyph, String label, int color, View.OnClickListener onClick) {
        TextView b = new TextView(this);
        b.setText(glyph);
        b.setTextColor(color);
        b.setTextSize(19f);
        b.setGravity(Gravity.CENTER);
        b.setContentDescription(label);
        b.setClickable(true);
        b.setFocusable(true);
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(44));
        b.setLayoutParams(lp);
        b.setOnClickListener(onClick);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static int parseColor(String raw, int fallback) {
        if (raw == null || raw.isEmpty()) return fallback;
        try {
            return Color.parseColor(raw);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
