#!/bin/bash

# Makes accounts.json

cat > /home/user/app/src/accounts.json <<EOF
${ACCOUNTS}
EOF

cat > /home/user/app/src/config.json <<EOF
{
    "baseURL": "https://rewards.bing.com",
    "sessionPath": "sessions",
    "headless": false,
    "clusters": 2,
    "errorDiagnostics": true,
    "workers": {
        "doDailySet": true,
        "doSpecialPromotions": true,
        "doMorePromotions": true,
        "doPunchCards": true,
        "doAppPromotions": true,
        "doDesktopSearch": true,
        "doMobileSearch": true,
        "doDailyCheckIn": true,
        "doReadToEarn": true
    },
    "searchOnBingLocalQueries": false,
    "globalTimeout": "600sec",
    "searchSettings": {
        "scrollRandomResults": true,
        "clickRandomResults": true,
        "parallelSearching": true,
        "queryEngines": ["google", "wikipedia", "reddit", "local"],
        "searchResultVisitTime": "30sec",
        "searchDelay": {
            "min": "17min",
            "max": "27min"
        },
        "readDelay": {
            "min": "3min",
            "max": "5min"
        }
    },
    "debugLogs": true,
    "consoleLogFilter": {
        "enabled": false,
        "mode": "whitelist",
        "levels": ["error", "warn"],
        "keywords": ["starting account"],
        "regexPatterns": []
    },
    "proxy": {
        "queryEngine": true
    },
    "webhook": {
        "discord": {
            "enabled": true,
            "url": "${TOKEN}"
        },
        "ntfy": {
            "enabled": false,
            "url": "",
            "topic": "",
            "token": "",
            "title": "Microsoft-Rewards-Script",
            "tags": ["bot", "notify"],
            "priority": 3
        },
        "webhookLogFilter": {
            "enabled": true,
            "mode": "whitelist",
            "levels": ["error"],
            "keywords": ["starting account", "select number", "collected", "completed"],
            "regexPatterns": []
        }
    }
}
EOF