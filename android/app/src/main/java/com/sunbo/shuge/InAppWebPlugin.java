package com.sunbo.shuge;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 打开 App 内置浏览器（InAppWebActivity）。
 * 颜色由前端按当前外观传进来（#rrggbb），这样工具栏跟 App 一致。
 */
@CapacitorPlugin(name = "InAppWeb")
public class InAppWebPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url 为空");
            return;
        }
        Intent i = new Intent(getContext(), InAppWebActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("bg", call.getString("bg", "#FBF9F4"));
        i.putExtra("fg", call.getString("fg", "#1A1A1A"));
        getActivity().startActivity(i);
        call.resolve(new JSObject());
    }
}
