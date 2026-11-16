package com.sunbo.shuge;

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
}
