// ==UserScript==
// @name        学习通视频自动播放助手
// @namespace   cx-auto-watch
// @version     1.4
// @description 超星学习通视频自动播放、自动续播与播放卡顿恢复的浏览器自动化脚本
// @author      Hermes
// @match       https://mooc1.chaoxing.com/*
// @match       https://mooc2.chaoxing.com/*
// @grant       unsafeWindow
// @run-at      document-idle
// ==/UserScript==

(function () {
    'use strict';
    const LOG = (...a) => console.log('%c[助手]', 'color:#00c853;font-weight:bold', ...a);
    const NO_VIDEO_WAIT = 6000;      // 无视频多少毫秒后判定为文档页并自动切换
    const STUCK_TIMEOUT = 20000;     // 视频进度多少毫秒不前进判定为卡死

    let panel;
    function makePanel() {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(0,0,0,.85);color:#eee;font:12px/1.7 "Microsoft YaHei";padding:10px 14px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.5);min-width:220px;max-width:300px';
        panel.innerHTML = '<div style="font-weight:bold;color:#00e676">✅ 学习通自动播放助手</div><div id="cxst">初始化…</div><button id="cxnext" style="margin-top:6px;background:#00c853;color:#000;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:bold">立即测试下一节</button>';
        document.body.appendChild(panel);
        panel.querySelector('#cxnext').onclick = goNext;
        return panel;
    }
    function setStatus(t) {
        const p = makePanel();
        const el = p.querySelector('#cxst');
        if (el) el.textContent = t;
    }

    function allDocs(root) {
        const out = [root];
        const walk = (doc) => {
            doc.querySelectorAll('iframe').forEach(fr => {
                try { if (fr.contentDocument) { out.push(fr.contentDocument); walk(fr.contentDocument); } } catch (e) {}
            });
        };
        walk(root);
        return out;
    }
    function allVideos() {
        const out = [];
        allDocs(document).forEach(doc => doc.querySelectorAll('video').forEach(v => out.push(v)));
        return out;
    }

    function findTextBtn() {
        let r = null;
        allDocs(document).forEach(doc => {
            if (r) return;
            doc.querySelectorAll('a,button,span,div,li').forEach(n => {
                if (r) return;
                const t = (n.innerText || '').trim();
                if (t && t.length <= 10 && /下一节|下一章|下一个|继续学习/.test(t)) r = n;
            });
        });
        return r;
    }

    function clickNextByChapterId() {
        const m = location.href.match(/chapterId=(\d+)/);
        if (!m) return false;
        const cur = m[1];
        const links = [];
        allDocs(document).forEach(doc => {
            doc.querySelectorAll('a[href*="chapterId"], [onclick*="chapterId"]').forEach(el => links.push(el));
        });
        let idx = -1;
        for (let i = 0; i < links.length; i++) {
            const s = (links[i].getAttribute('href') || '') + (links[i].getAttribute('onclick') || '');
            if (s.indexOf(cur) >= 0) { idx = i; break; }
        }
        if (idx >= 0 && idx + 1 < links.length) {
            links[idx + 1].click();
            return true;
        }
        return false;
    }

    function clickNextSibling() {
        let r = false;
        allDocs(document).forEach(doc => {
            if (r) return;
            const cur = doc.querySelector('.current, .active, .cur, .on, .selected, .currents');
            if (cur && cur.parentElement) {
                const sib = cur.parentElement.nextElementSibling;
                if (sib) {
                    const a = sib.querySelector('a, [onclick]') || sib;
                    if (a) { a.click(); r = true; }
                }
            }
        });
        return r;
    }

    function goNext() {
        LOG('== 尝试切换下一节 ==');
        const b = findTextBtn();
        if (b) { b.click(); setStatus('已点下一节(文本)'); return; }
        if (clickNextByChapterId()) { setStatus('已切换下一章(chapterId)'); return; }
        if (clickNextSibling()) { setStatus('已切换下一章(兄弟节点)'); return; }
        setStatus('⚠️ 没找到切换入口，请手动点');
        LOG('三种策略都失败');
    }

    function clickConfirm() {
        const texts = ['继续观看', '继续学习', '我知道了', '知道了', '确定', '确认', '继续', '好的'];
        let hit = false;
        allDocs(document).forEach(doc => {
            doc.querySelectorAll('button,a,span,div').forEach(n => {
                const t = (n.innerText || '').trim();
                if (texts.indexOf(t) >= 0 && n.offsetParent !== null) { n.click(); hit = true; LOG('点弹窗:', t); }
            });
        });
        return hit;
    }

    const handled = new WeakSet();
    function handleVideo(v) {
        if (handled.has(v)) return;
        handled.add(v);
        v.muted = false;
        v.volume = 0.01;
        v.play().catch(() => setStatus('⚠️ 请手动点一下播放键▶'));
        LOG('接管视频');
        v.addEventListener('ended', () => { setStatus('本集看完，切换下一节…'); setTimeout(goNext, 1200); });
    }

    // ---------- 防卡死 ----------
    let lastProgressTime = -1;   // 上次记录到的视频进度
    let lastProgressAt = Date.now(); // 上次进度前进的时间点
    let stuckStage = 0;          // 卡死恢复阶段

    function recoverStuck(v, stage) {
        LOG('检测到卡死，恢复阶段', stage);
        if (stage === 1) {
            setStatus('⚠️ 视频卡顿，强制播放…');
            v.play().catch(()=>{});
        } else if (stage === 2) {
            setStatus('⚠️ 仍卡顿，跳过 3 秒…');
            try { v.currentTime = Math.min(v.currentTime + 3, v.duration); } catch(e) {}
            v.play().catch(()=>{});
        } else if (stage === 3) {
            setStatus('⚠️ 多次卡顿，跳过本节…');
            goNext();
        } else {
            setStatus('⚠️ 严重卡顿，刷新页面…');
            location.reload();
        }
        lastProgressTime = v.currentTime;
        lastProgressAt = Date.now();
    }

    let curChapter = '';
    let chapterChangeTime = Date.now();

    makePanel();
    setStatus('运行中…');
    LOG('脚本加载完成 v1.4');

    setInterval(() => {
        const m = location.href.match(/chapterId=(\d+)/);
        const ch = m ? m[1] : '';
        if (ch !== curChapter) {
            curChapter = ch;
            chapterChangeTime = Date.now();
            lastProgressTime = -1;
            stuckStage = 0;
            LOG('进入任务点', ch);
        }

        const vs = allVideos();
        if (vs.length) {
            vs.forEach(v => {
                handleVideo(v);
                if (v.paused && !v.ended) { v.play().catch(()=>{}); }
            });
            const v = vs[0];
            // 防卡死：视频在但进度长时间不前进
            if (v.duration && !v.ended) {
                const t = v.currentTime;
                if (lastProgressTime < 0) {
                    lastProgressTime = t;
                    lastProgressAt = Date.now();
                } else if (t > lastProgressTime + 0.5) {
                    lastProgressTime = t;
                    lastProgressAt = Date.now();
                    stuckStage = 0;
                } else if (Date.now() - lastProgressAt > STUCK_TIMEOUT) {
                    stuckStage++;
                    recoverStuck(v, stuckStage);
                }
            }
            const pct = v.duration ? Math.round(v.currentTime / v.duration * 100) : 0;
            setStatus('播放中 ' + pct + '%');
        } else {
            const wait = Date.now() - chapterChangeTime;
            if (wait > NO_VIDEO_WAIT) {
                setStatus('无视频(测验/文档)，自动跳过…');
                chapterChangeTime = Date.now();
                goNext();
            } else {
                setStatus('等待视频加载 ' + Math.round(wait/1000) + 's');
            }
        }

        clickConfirm();
    }, 2000);
})();