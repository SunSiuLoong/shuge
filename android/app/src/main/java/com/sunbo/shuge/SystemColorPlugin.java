package com.sunbo.shuge;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把系统动态色（Material You / 莫奈取色）交给前端。
 *
 * Android 12（API 31）起系统会从壁纸生成 system_accent1_* 这组颜色，
 * 这里读 200（主色，中等明度）作为强调色，100/300 作为辅助色。
 * 12 以下没有这组资源，直接 resolve 空对象，前端会退回设置里存的 hex。
 */
@CapacitorPlugin(name = "SystemColor")
public class SystemColorPlugin extends Plugin {

    private String colorOf(int resId) {
        try {
            int c = getContext().getResources().getColor(resId, getContext().getTheme());
            return String.format("#%06X", 0xFFFFFF & c);
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void getColors(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ret.put("accent", colorOf(android.R.color.system_accent1_200));
            ret.put("accent2", colorOf(android.R.color.system_accent2_200));
            ret.put("accent3", colorOf(android.R.color.system_accent3_200));
        }
        call.resolve(ret);
    }

    /**
     * [shuge] 读系统明暗（uiMode 的 NIGHT_MASK）。
     * WebView 的 prefers-color-scheme 在部分 ROM/WebView 版本上不可靠
     * （系统已切亮色、matchMedia 仍报 dark），前端以这里的值为准。
     */
    @PluginMethod
    public void getDarkMode(PluginCall call) {
        int mask = getContext().getResources()
            .getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        JSObject ret = new JSObject();
        ret.put("dark", mask == Configuration.UI_MODE_NIGHT_YES);
        call.resolve(ret);
    }

    /**
     * [shuge] 系统明暗切换时通知前端。Capacitor 的 Bridge 会在
     * onConfigurationChanged 里调这个钩子。
     */
    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        int mask = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        JSObject ret = new JSObject();
        ret.put("dark", mask == Configuration.UI_MODE_NIGHT_YES);
        notifyListeners("systemDarkChanged", ret);
    }

    /**
     * [shuge] 同步 Activity 窗口背景色。老 WebView（<140）走 SystemBars 的
     * 原生 padding 路径时，状态栏区域露出的是窗口背景（capacitor.config
     * 里静态的 #FBF9F4），暗色主题下会是一条刺眼的白边——前端在主题/路由
     * 变化时调这个方法，把窗口背景刷成当前页面的底色。新 WebView 的
     * passthrough 路径看不到窗口背景，调了也无害。
     */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        String color = call.getString("color");
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().getWindow()
                    .setBackgroundDrawable(new ColorDrawable(Color.parseColor(color)));
            } catch (Exception ignored) {
                // 颜色串非法就保持原样
            }
        });
        call.resolve();
    }
}
