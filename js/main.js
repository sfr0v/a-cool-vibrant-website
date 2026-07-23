/* ==========================================================================
   Azure Bay — логика сайта (без внешних библиотек)
   1. Интро-видео: играет один раз, затем застывает последним кадром
      и становится фоном сайта.
   2. Шапка: прозрачная вверху, чёрная при прокрутке.
   3. Появление секций при прокрутке (IntersectionObserver).
   4. Корзина магазина (счётчик + сумма, без бэкенда).
   5. Форма брони: валидация дат, демо-отправка.
   ========================================================================== */

'use strict';

/* ---------- Настройки ---------- */
const CONFIG = {
  INTRO_MAX_WAIT: 4000,   // мс: видео не начало играть за это время → пропускаем интро
  INTRO_HARD_CAP: 20000,  // мс: абсолютный потолок длительности интро (страховка)
  INTRO_ONCE_PER_SESSION: false // true → интро показывается раз за вкладку (sessionStorage)
};

document.addEventListener('DOMContentLoaded', () => {
  initIntro();
  initHeader();
  initReveal();
  initCart();
  initBooking();
});

/* ==========================================================================
   1. ИНТРО-ВИДЕО
   ========================================================================== */
function initIntro() {
  const root  = document.documentElement;
  const intro = document.getElementById('intro');
  const video = document.getElementById('intro-video');
  const skip  = document.getElementById('intro-skip');

  let finished = false;

  /* Завершение интро. Слой с видео НЕ удаляется: он уходит под контент
     (z-index: -1), а застывший ПОСЛЕДНИЙ КАДР ролика становится фоном
     сайта. Если кадра нет (видео не загрузилось / пропущено до старта) —
     вешаем .no-backdrop, слой прячется, работает запасной синий фон. */
  function endIntro() {
    if (finished) return;
    finished = true;

    /* readyState >= 2 — у видео есть декодированный кадр для показа */
    const hasFrame = !video.error && video.readyState >= 2 && video.duration > 0;
    if (hasFrame) {
      video.pause();
      /* Если ролик не доигран (нажали «Пропустить») — перематываем
         на последний кадр, чтобы фон был одинаковым у всех. */
      if (!video.ended) video.currentTime = video.duration;
    } else {
      root.classList.add('no-backdrop');
      video.removeAttribute('src'); // не держим декодер зря
      video.load();
    }

    root.classList.remove('intro-active');
    root.classList.add('site-ready');
  }

  skip.addEventListener('click', endIntro);

  /* Интро пропускаем целиком (и не грузим видео), если:
     - пользователь просил меньше анимаций;
     - включена экономия трафика или сеть 2G;
     - интро уже показывали в этой вкладке (опция). */
  const conn = navigator.connection || {};
  const skipIntro =
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    conn.saveData === true ||
    /(^|-)2g$/.test(conn.effectiveType || '') ||
    (CONFIG.INTRO_ONCE_PER_SESSION && sessionStorage.getItem('introShown'));

  if (skipIntro) { endIntro(); return; }
  if (CONFIG.INTRO_ONCE_PER_SESSION) sessionStorage.setItem('introShown', '1');

  /* Загружаем видео заранее (даже в фоновой вкладке — пусть кэшируется).
     Источник — в data-src (см. index.html). */
  video.src = video.dataset.src;
  video.load();

  video.addEventListener('ended', endIntro, { once: true });
  video.addEventListener('error', endIntro, { once: true });

  /* Chrome ставит беззвучное видео на паузу в ФОНОВОЙ вкладке (экономия
     энергии). Поэтому: запускаем интро только когда вкладка видима,
     а если её свернули посреди ролика — доигрываем после возврата. */
  function startPlayback() {
    if (finished) return;
    const p = video.play();
    /* Настоящий запрет автоплея (NotAllowedError) — просто пропускаем интро. */
    if (p && p.catch) p.catch(() => { if (!document.hidden) endIntro(); });

    /* Страховки: не держим пользователя на чёрном экране. */
    const waitGuard = setTimeout(() => {
      if (video.currentTime === 0) endIntro();   // так и не началось
    }, CONFIG.INTRO_MAX_WAIT);
    video.addEventListener('playing', () => clearTimeout(waitGuard), { once: true });
    setTimeout(endIntro, CONFIG.INTRO_HARD_CAP); // абсолютный потолок
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || finished) return;
    if (video.currentTime === 0) startPlayback();          // ещё не стартовало
    else if (video.paused && !video.ended) video.play().catch(() => {}); // доигрываем
  });

  if (!document.hidden) startPlayback();
}

/* ==========================================================================
   2. ШАПКА
   Вверху страницы шапка прозрачна (под ней кадр-фон). При прокрутке
   становится чёрной — иначе белый текст потеряется на белых секциях.
   ========================================================================== */
function initHeader() {
  const header = document.querySelector('.site-header');
  const onScroll = () =>
    header.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ==========================================================================
   3. ПОЯВЛЕНИЕ СЕКЦИЙ ПРИ ПРОКРУТКЕ
   Элементам .reveal добавляется .is-visible, когда они входят в экран.
   ========================================================================== */
function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target); // анимация одноразовая
      }
    });
  }, { threshold: 0.15 });
  items.forEach(el => io.observe(el));
}

/* ==========================================================================
   4. КОРЗИНА МАГАЗИНА
   Демо без бэкенда: считаем количество и сумму, храним в sessionStorage,
   чтобы корзина переживала перезагрузку вкладки.
   ========================================================================== */
function initCart() {
  const state = JSON.parse(sessionStorage.getItem('cart') || '{"count":0,"total":0}');

  const countEl   = document.getElementById('cart-count');
  const summary   = document.getElementById('cart-summary');
  const sumCount  = document.getElementById('cart-summary-count');
  const sumTotal  = document.getElementById('cart-summary-total');

  function plural(n, one, few, many) { // 1 товар / 2 товара / 5 товаров
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function render() {
    countEl.hidden = state.count === 0;
    countEl.textContent = state.count;
    summary.hidden = state.count === 0;
    sumCount.textContent = state.count + ' ' + plural(state.count, 'товар', 'товара', 'товаров');
    sumTotal.textContent = state.total.toLocaleString('ru-RU') + ' ₽';
  }
  render();

  document.querySelectorAll('.js-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.product');
      state.count += 1;
      state.total += Number(card.dataset.price) || 0;
      sessionStorage.setItem('cart', JSON.stringify(state));
      render();

      /* Короткая обратная связь на кнопке */
      btn.classList.add('is-added');
      const original = btn.textContent;
      btn.textContent = 'Добавлено';
      setTimeout(() => {
        btn.classList.remove('is-added');
        btn.textContent = original;
      }, 1200);
    });
  });
}

/* ==========================================================================
   5. ФОРМА БРОНИРОВАНИЯ
   Валидация: обе даты заданы, выезд позже заезда, заезд не в прошлом,
   корректный email. Реальную отправку подключите вместо showDone().
   ========================================================================== */
function initBooking() {
  const form     = document.getElementById('booking-form');
  const checkin  = document.getElementById('f-checkin');
  const checkout = document.getElementById('f-checkout');
  const email    = document.getElementById('f-email');
  const errorEl  = document.getElementById('booking-error');
  const doneEl   = document.getElementById('booking-done');

  /* Раньше сегодняшнего дня заехать нельзя.
     Дату собираем из ЛОКАЛЬНЫХ компонентов: toISOString() дал бы UTC,
     и рядом с полуночью «сегодня» съезжало бы на соседний день. */
  const now = new Date();
  const today = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  checkin.min = today;
  checkout.min = today;

  /* Выезд всегда позже заезда: подтягиваем ограничение динамически */
  checkin.addEventListener('change', () => {
    if (checkin.value) {
      const next = new Date(checkin.value);
      next.setDate(next.getDate() + 1);
      checkout.min = next.toISOString().slice(0, 10);
      if (checkout.value && checkout.value <= checkin.value) checkout.value = '';
    }
  });

  function fail(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    errorEl.hidden = true;

    if (!checkin.value || !checkout.value) return fail('Укажите даты заезда и выезда.');
    if (checkin.value < today)             return fail('Дата заезда уже в прошлом.');
    if (checkout.value <= checkin.value)   return fail('Выезд должен быть позже заезда.');
    if (!email.checkValidity())            return fail('Проверьте адрес почты.');

    /* ДЕМО: здесь должен быть fetch('/api/booking', {method: 'POST', ...}).
       Пока просто показываем подтверждение. */
    form.hidden = true;
    doneEl.hidden = false;
  });
}
