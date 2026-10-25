/* Shared behavior for pandey.realty pages: nav menu, mobile CTA bar, lead form, payment math, section reveal. */
window.PR = (() => {
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };
  const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const fmtInput = (el) => { if (el.value.trim() !== "") el.value = num(el.value).toLocaleString("en-US"); };

  function nav(onScrollExtra) {
    const links = $("links"), btn = $("menuBtn"), cta = $("ctaBar");
    const close = () => { links.classList.remove("open"); btn.setAttribute("aria-expanded", false); btn.textContent = "Menu"; };
    btn.onclick = () => { const o = links.classList.toggle("open"); btn.setAttribute("aria-expanded", o); btn.textContent = o ? "Close" : "Menu"; onScrollExtra && onScrollExtra(); };
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
    const onScroll = () => { if (cta) cta.classList.toggle("show", scrollY > innerHeight * 0.6); onScrollExtra && onScrollExtra(); };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // Monthly payment: principal & interest + tax + insurance + estimated mortgage insurance
  function payment({ price, downPct, rate, years, taxRate, insurance }) {
    const loan = price * (1 - downPct / 100), r = rate / 1200, n = years * 12;
    const pi = loan > 0 ? (r ? loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : loan / n) : 0;
    const tax = price * taxRate / 12;
    const fha = Math.abs(downPct - 3.5) < 0.01;
    const mi = downPct >= 20 ? 0 : loan * (fha ? 0.0055 : 0.005) / 12;
    return { loan, pi, tax, ins: insurance, mi, total: pi + tax + insurance + mi, down: price * downPct / 100 };
  }

  function leadForm({ listing = "", defaultTopic = "", whenTopic = "" } = {}) {
    const form = $("leadForm"); if (!form) return;
    const status = $("fStatus"), submit = $("fSubmit"), started = Date.now();
    let topic = defaultTopic;
    const seg = form.querySelectorAll("#topic button");
    const setTopic = (b) => {
      topic = b.dataset.v; seg.forEach((x) => x.setAttribute("aria-pressed", x === b));
      if ($("whenRow")) $("whenRow").hidden = whenTopic ? topic !== whenTopic : true;
      if (/pre-approv|financ/i.test(topic) && $("fLoan")) $("fLoan").checked = true;
    };
    seg.forEach((b) => (b.onclick = () => setTopic(b)));
    const first = [...seg].find((b) => b.getAttribute("aria-pressed") === "true") || seg[0];
    if (first) setTopic(first);
    if ($("fDate")) { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); $("fDate").min = t.toISOString().slice(0, 10); }
    document.querySelectorAll("[data-topic]").forEach((a) => a.addEventListener("click", () => {
      const b = [...seg].find((x) => x.dataset.v === a.dataset.topic); if (b) setTopic(b);
    }));
    const say = (msg, kind) => { status.textContent = msg; status.className = "status " + kind; status.hidden = false; };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("fName").value.trim(), email = $("fEmail").value.trim(), phone = $("fPhone").value.trim();
      if (!name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Please enter your name, phone number, and a valid email address.", "err"); return; }
      if ($("fConsent") && !$("fConsent").checked) { say("Please check the box so Nayan can contact you about your request.", "err"); return; }
      submit.disabled = true; submit.textContent = "Sending…"; status.hidden = true;
      const showWhen = $("whenRow") && !$("whenRow").hidden;
      try {
        const res = await fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          topic, listing, page: location.href, name, email, phone,
          date: showWhen && $("fDate") ? $("fDate").value : "", time: showWhen && $("fTime") ? $("fTime").value : "",
          message: $("fMsg").value.trim(), preapproval: !!($("fLoan") && $("fLoan").checked), consent: !!($("fConsent") && $("fConsent").checked),
          website: $("fWeb").value, elapsed: Date.now() - started }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) { form.reset(); if (first) setTopic(first); say("Thanks, " + name.split(" ")[0] + "! Your message was sent. Nayan will get back to you shortly.", "ok"); submit.textContent = "Sent"; return; }
        throw new Error(data.error || "send failed");
      } catch (err) { say("Sorry, your message couldn't be sent. Please call or text Nayan at (469) 407-5853.", "err"); submit.disabled = false; submit.textContent = "Send message"; }
    });
  }

  function reveal() {
    if (!("IntersectionObserver" in window) || reduce) return;
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.remove("pre"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add("pre"); io.observe(el); } });
  }

  return { $, num, usd, fmtInput, nav, payment, leadForm, reveal, reduce };
})();
