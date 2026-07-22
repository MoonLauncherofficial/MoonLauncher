/* =========================================================
   MoonLauncher — UI Enhancement Layer
   Purely additive DOM/CSS micro-interactions.
   Loaded AFTER app.js. Never calls preventDefault/stopPropagation,
   never overrides existing functions or IPC calls — safe to remove
   at any time without affecting core launcher functionality.
   ========================================================= */
(function () {
    'use strict';

    const RIPPLE_SELECTOR =
        '.play-btn, .action-btn, .add-btn, .item-btn, .icon-btn, .tb-btn, ' +
        '.nav-item, .tab, .server-join-btn, .microsoft-login-btn, .link-btn, .action-card';

    // ---------- Ripple feedback on press ----------
    function spawnRipple(target, x, y) {
        const rect = target.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height) * 1.6;
        ripple.className = 'ml-ripple';
        ripple.style.cssText =
            'position:absolute;pointer-events:none;border-radius:50%;' +
            'background:rgba(255,255,255,.35);transform:translate(-50%,-50%) scale(0);' +
            'width:' + size + 'px;height:' + size + 'px;' +
            'left:' + (x - rect.left) + 'px;top:' + (y - rect.top) + 'px;' +
            'transition:transform .5s cubic-bezier(.22,1,.36,1), opacity .6s ease;' +
            'opacity:.9;z-index:0;';

        const computedPosition = getComputedStyle(target).position;
        if (computedPosition === 'static') target.style.position = 'relative';
        const prevOverflow = getComputedStyle(target).overflow;
        if (prevOverflow === 'visible') target.style.overflow = 'hidden';

        target.appendChild(ripple);
        requestAnimationFrame(() => {
            ripple.style.transform = 'translate(-50%,-50%) scale(1)';
            ripple.style.opacity = '0';
        });
        setTimeout(() => ripple.remove(), 650);
    }

    document.addEventListener('mousedown', (e) => {
        const target = e.target.closest(RIPPLE_SELECTOR);
        if (!target || target.disabled) return;
        spawnRipple(target, e.clientX, e.clientY);
    }, { passive: true });

    // ---------- Subtle magnetic tilt on the hero play button ----------
    // Раньше getBoundingClientRect() вызывался на КАЖДОМ mousemove — это форсирует
    // синхронный пересчёт layout с частотой движения мыши (сотни раз в секунду).
    // Теперь rect кэшируется на mouseenter/resize, а запись transform батчится
    // через requestAnimationFrame, чтобы не писать в стиль чаще одного раза за кадр.
    function initHeroTilt() {
        const hero = document.getElementById('playBtn');
        if (!hero || hero.dataset.tiltBound) return;
        hero.dataset.tiltBound = '1';

        let rect = null;
        let rafId = null;
        let lastX = 0, lastY = 0;

        const refreshRect = () => { rect = hero.getBoundingClientRect(); };

        hero.addEventListener('mouseenter', refreshRect, { passive: true });
        window.addEventListener('resize', () => { if (rect) refreshRect(); }, { passive: true });

        hero.addEventListener('mousemove', (e) => {
            lastX = e.clientX; lastY = e.clientY;
            if (!rect) refreshRect();
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const relX = (lastX - rect.left) / rect.width - 0.5;
                const relY = (lastY - rect.top) / rect.height - 0.5;
                hero.style.transform = `perspective(600px) rotateX(${(-relY * 4).toFixed(2)}deg) rotateY(${(relX * 4).toFixed(2)}deg) translateY(-1px)`;
            });
        }, { passive: true });

        hero.addEventListener('mouseleave', () => {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            hero.style.transform = '';
        }, { passive: true });
    }

    // ---------- Animated number counters for stat values ----------
    // ВАЖНО: animateCount вызывается из MutationObserver, который слушает
    // childList/characterData на ЭТОМ ЖЕ элементе. Раньше step() каждый кадр
    // писал el.textContent — а это сама по себе мутация, которая заново
    // триггерила тот же MutationObserver. Guard `dataset.counted === target`
    // сравнивался с ЕЩЁ НЕ ДОРИСОВАННЫМ промежуточным числом на экране, а не
    // с финальным значением, поэтому не спасал: каждый промежуточный кадр
    // анимации распознавался как "новое" значение и запускал ЕЩЁ один
    // параллельный step()-цикл поверх уже идущего. Эти циклы плодились
    // экспоненциально (каждый пишет textContent → каждая запись рождает ещё
    // цикл), и именно это вешало окно лаунчера сразу после смены инстанса —
    // потому что homeModCount/homePlayTime обновляются в
    // updateHomeProfileDisplay() ровно в момент selectProfile().
    // Фикс: запоминаем, что последний раз в el.textContent писали МЫ САМИ
    // (dataset.lastWritten), и в начале функции игнорируем мутацию, если
    // текущий текст совпадает с тем, что мы сами только что записали —
    // то есть это "эхо" от собственного кадра анимации, а не реальное
    // внешнее изменение значения.
    function animateCount(el) {
        const text = el.textContent.trim();
        if (text === el.dataset.lastWritten) return;
        const match = text.match(/^(\d[\d\s]*)(.*)$/);
        if (!match) return;
        const target = parseInt(match[1].replace(/\s/g, ''), 10);
        if (!Number.isFinite(target) || target <= 0 || el.dataset.counted === String(target)) return;
        el.dataset.counted = String(target);
        const suffix = match[2] || '';
        const duration = 600;
        const start = performance.now();
        function step(now) {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            const rendered = p < 1
                ? Math.round(target * eased).toLocaleString('ru-RU') + suffix
                : text; // на последнем кадре возвращаем ровно исходную строку — без потери форматирования
            el.dataset.lastWritten = rendered;
            el.textContent = rendered;
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function watchStatValues() {
        const ids = ['homeModCount', 'homePlayTime', 'onlineCounter'];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const obs = new MutationObserver(() => animateCount(el));
            obs.observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    // ---------- Pause decorative animations when window is unfocused/minimized ----------
    // Аврора-фон, дыхание Play-кнопки, линия в шапке и т.д. раньше крутились
    // бесконечно, даже свёрнутыми — грузили GPU/CPU впустую в фоне.
    function initAnimationPausing() {
        const root = document.documentElement;
        const pause = () => root.classList.add('anim-paused');
        const resume = () => { if (!document.hidden) root.classList.remove('anim-paused'); };
        window.addEventListener('blur', pause);
        window.addEventListener('focus', resume);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) pause(); else resume();
        });
        if (document.hidden) pause();
    }

    function init() {
        initHeroTilt();
        watchStatValues();
        initAnimationPausing();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
