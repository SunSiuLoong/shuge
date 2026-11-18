package com.sunbo.shuge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册，否则 Bridge 初始化时拿不到这个插件
        registerPlugin(SystemColorPlugin.class);
        // 引用模式导入（不复制原文件）的 SAF 选择器与分块读取
        registerPlugin(LocalFilePlugin.class);
        // 社区（阡陌居）HTTP 桥 + 附件下载
        registerPlugin(CommunityPlugin.class);
        // App 内置浏览器（整屏 WebView，Cookie 与社区 HTTP 桥共用）
        registerPlugin(InAppWebPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
