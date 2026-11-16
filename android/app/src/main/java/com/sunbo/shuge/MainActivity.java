package com.sunbo.shuge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册，否则 Bridge 初始化时拿不到这个插件
        registerPlugin(SystemColorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
