// extensions/<your-extension>/assets/loyalty-widget.js
(() => {
  const script = document.currentScript;
  const root = script && script.closest('.loyalty-widget');
  if (!root) return;

  // Maintain the visual variant class (inline/badge/card)
  const widgetVariant = root.dataset.variant || 'card';
  root.classList.remove('loyalty-widget--inline', 'loyalty-widget--badge', 'loyalty-widget--card');
  root.classList.add(`loyalty-widget--${widgetVariant}`);

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const rounding = (root.dataset.rounding || 'nearest').toLowerCase();
  const rate = Number(root.dataset.rate || 10);

  function round(value, mode) {
    if (mode === 'down') return Math.floor(value);
    if (mode === 'up') return Math.ceil(value);
    return Math.round(value);
  }
  function computePointsFromCents(cents) {
    const major = Number(cents || 0) / 100;
    return round(major * rate, rounding);
  }
  function replaceStrongNumber(el, number) {
    if (!el) return;
    const html = el.innerHTML || '';
    const strongRegex = /<strong>.*?<\/strong>/i;
    if (strongRegex.test(html)) {
      el.innerHTML = html.replace(strongRegex, `<strong>${number}</strong>`);
    } else {
      el.innerHTML = `${html.trim()} <span>Earn <strong>${number}</strong> points.</span>`;
    }
  }

  // ------------------------------------------------------------
  // Product Points: live update on variant change
  // ------------------------------------------------------------
  if (root.dataset.component === 'product-points') {
    const textEl = root.querySelector('.loyalty-widget__subtext');
    const section = root.closest('[id^="shopify-section-"]') || document;

    function readProductJSON(ctx) {
      const sels = [
        'script[type="application/json"][data-product]',
        'script[type="application/json"][data-product-json]',
        'script[type="application/json"][data-product-data]',
        'script[type="application/json"][id^="ProductJson-"]',
        'script[type="application/json"][id^="product-json-"]',
      ];
      for (const sel of sels) {
        const el = ctx.querySelector(sel);
        if (!el) continue;
        try {
          const obj = JSON.parse(el.textContent || '{}');
          if (obj && Array.isArray(obj.variants)) return obj;
          if (obj && obj.product && Array.isArray(obj.product.variants)) return obj.product;
        } catch {}
      }
      return null;
    }
    const productJSON = readProductJSON(section);

    function pickVariantById(id) {
      if (!productJSON || !id) return null;
      const idNum = Number(id);
      return productJSON.variants.find(v => Number(v.id) === idNum) || null;
    }
    function readPriceFromDOM(ctx) {
      const sels = [
        '[data-product-price]',
        '.price__regular .price-item--regular',
        '.price .price-item--regular',
        '.price .price-item--sale',
        '.price .price__current',
        '[itemprop="price"]',
      ];
      for (const sel of sels) {
        const el = ctx.querySelector(sel);
        if (!el) continue;
        const raw = (el.getAttribute('content') || el.textContent || '').trim();
        const digits = raw.replace(/[^\d.,]/g, '');
        if (!digits) continue;
        const normalized = digits.replace(',', '.');
        const parts = normalized.split('.');
        if (parts.length === 1) {
          const major = Number(parts[0].replace(/\D/g, ''));
          if (!Number.isNaN(major)) return major * 100;
        } else {
          const major = parts[0].replace(/\D/g, '') || '0';
          const minor = (parts[1].replace(/\D/g, '') + '00').slice(0, 2);
          const cents = Number(major) * 100 + Number(minor);
          if (!Number.isNaN(cents)) return cents;
        }
      }
      return null;
    }

    function recalcFromVariant(variant) {
      const cents = Number(variant?.price ?? (variant?.priceV2?.amount ? Number(variant.priceV2.amount) * 100 : 0));
      if (cents > 0) {
        root.dataset.priceCents = String(cents);
        replaceStrongNumber(textEl, computePointsFromCents(cents));
      }
    }
    function recalcFromDOM() {
      const cents = readPriceFromDOM(section);
      if (cents && cents > 0) {
        root.dataset.priceCents = String(cents);
        replaceStrongNumber(textEl, computePointsFromCents(cents));
      }
    }

    // Initial render
    const initial = Number(root.dataset.priceCents || 0);
    if (initial > 0) replaceStrongNumber(textEl, computePointsFromCents(initial));
    else recalcFromDOM();

    // Listen for variant changes
    function onVariantChange(e) {
      const v = e?.detail?.variant;
      if (v) return recalcFromVariant(v);

      const select = section.querySelector('form[action*="/cart/add"] select[name="id"]');
      const selectedId = select && select.value;
      const found = selectedId && pickVariantById(selectedId);
      if (found) return recalcFromVariant(found);

      recalcFromDOM();
    }
    ['variant:change', 'shopify:variant:change', 'product:variant:change', 'theme:variant:change', 'variant:changed']
      .forEach(evt => section.addEventListener(evt, onVariantChange));

    const select = section.querySelector('form[action*="/cart/add"] select[name="id"]');
    if (select) select.addEventListener('change', onVariantChange);

    const priceNode = section.querySelector('[data-product-price]') || section.querySelector('.price');
    if (priceNode && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => recalcFromDOM());
      mo.observe(priceNode, { childList: true, subtree: true, characterData: true });
    }
  }

  // ------------------------------------------------------------
  // Cart Points: live update on AJAX cart changes
  // ------------------------------------------------------------
  if (root.dataset.component === 'cart-points') {
    const textEl = root.querySelector('.loyalty-widget__subtext');

    async function fetchCartCents() {
      try {
        const res = await fetch('/cart.js', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('cart fetch failed');
        const cart = await res.json();
        // cart.total_price is in cents
        return Number(cart.total_price || 0);
      } catch {
        return null;
      }
    }

    async function recalcFromCart() {
      const cents = await fetchCartCents();
      if (cents == null) return;
      root.dataset.priceCents = String(cents);
      const pts = computePointsFromCents(cents);
      if (textEl) {
        // Two common sentences handled:
        //  - "You’ll earn <strong>X</strong> points for this order."
        //  - any existing text → we append or replace <strong>…</strong>
        replaceStrongNumber(textEl, pts);
        // If your block text expects specific phrasing, ensure it exists:
        if (!/You.?ll earn/i.test(textEl.textContent || '')) {
          textEl.innerHTML = `You’ll earn <strong>${pts}</strong> points for this order.` + (textEl.innerHTML ? ` ${textEl.innerHTML}` : '');
        }
      }
    }

    // Initial calc (server provided data or a quick fetch)
    const initial = Number(root.dataset.priceCents || 0);
    if (initial > 0) replaceStrongNumber(textEl, computePointsFromCents(initial));
    else recalcFromCart();

    // Listen to common cart update events used by themes/apps
    const evtNames = [
      'cart:updated',
      'cart:change',
      'cart:update',
      'cart:refresh',
      'ajaxCart:updated',
      'cart:requestComplete',
      'cart-drawer:updated',
    ];
    evtNames.forEach(name => window.addEventListener(name, recalcFromCart));

    // Fallback: intercept fetch() calls that mutate the cart, then refresh points
    // This is lightweight and avoids heavy monkey-patching of XHR.
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      try {
        const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
        if (typeof url === 'string' && /\/cart(\/(add|change|update|clear|add.js|change.js|update.js|clear.js))?/.test(url)) {
          // give the theme a tick to update quantities/prices, then recompute
          setTimeout(recalcFromCart, 50);
        }
      } catch {}
      return res;
    };

    // Safety net: observe cart total DOM changes when available
    const cartScope =
      root.closest('[data-cart]') ||
      document.querySelector('[data-cart]') ||
      document;
    const totalNode =
      cartScope.querySelector('[data-cart-total]') ||
      cartScope.querySelector('.cart__subtotal, .totals__subtotal-value, .cart-drawer__footer, .order-summary__section--total');
    if (totalNode && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => recalcFromCart());
      mo.observe(totalNode, { childList: true, subtree: true, characterData: true });
    }
  }
})();
