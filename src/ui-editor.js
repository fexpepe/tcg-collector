(function () {
  // ═══════════════════════════════════════════════════════════════════════════
  // UI EDITOR (experimental, só em modo de teste)
  //
  // Ferramenta de design AO VIVO: clique num elemento pra selecionar, arraste
  // pra mover (transform), use a alça ◢ pra redimensionar, e ajuste espaçamento,
  // fonte, cores, raio e gap no painel. Tudo vira um JSON de overrides
  // (localStorage) reaplicado a cada página enquanto o modo estiver ligado.
  //
  // Fluxo com o Claude: [Exportar JSON] -> cola no chat / commita em
  // design/ui-overrides.json -> o Claude converte em CSS definitivo no
  // styles.css (com julgamento: breakpoints, temas, acessibilidade).
  //
  // Ativação: Configurações -> "UI Editor" OU ?uieditor=1 (o shared.js injeta
  // este script só quando a flag está ligada — custo zero pros usuários).
  // ═══════════════════════════════════════════════════════════════════════════
  const STORE_KEY = "tcg-ui-editor-overrides-v1";
  const PANEL_ID = "uiEditorPanel";
  if (document.getElementById(PANEL_ID)) return;

  // ── Estado ──────────────────────────────────────────────────────────────────
  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { overrides = {}; }
  let selected = null;      // elemento selecionado
  let selector = "";        // seletor estável do selecionado
  let picking = false;      // modo "escolher elemento"
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(overrides)); } catch (e) { /* quota */ } };

  // ── Overrides -> <style> (reaplicado a cada mudança) ───────────────────────
  const styleEl = document.createElement("style");
  styleEl.id = "uiEditorOverrides";
  document.head.appendChild(styleEl);
  function applyAll() {
    styleEl.textContent = Object.entries(overrides).map(([sel, props]) => {
      const body = Object.entries(props).map(([k, v]) => `${k}: ${v} !important;`).join(" ");
      return body ? `${sel} { ${body} }` : "";
    }).join("\n");
  }
  applyAll();

  // ── Seletor estável: #id > classe(s) útil(is) + nth-of-type, até 4 níveis ──
  const IGNORE_CLASSES = /^(active|owned|wanted|added|is-|has-|hidden)/;
  function stableSelector(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 4) {
      if (node.id && !/^(radix|__)/.test(node.id)) { parts.unshift(`#${node.id}`); break; }
      const cls = Array.from(node.classList).filter((c) => !IGNORE_CLASSES.test(c));
      let part = node.tagName.toLowerCase();
      if (cls.length) part += `.${cls[0]}`;
      // nth-of-type só quando o pai tem irmãos iguais (senão o seletor fica frágil)
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((s) => s.tagName === node.tagName && (!cls.length || s.classList.contains(cls[0])));
        if (same.length > 1) part += `:nth-of-type(${Array.from(parent.children).filter((s) => s.tagName === node.tagName).indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // ── Painel ──────────────────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="uie-head" data-uie-drag>
      <strong>UI Editor</strong>
      <span class="uie-badge">beta</span>
      <button type="button" class="uie-x" data-uie-close title="Fechar (desliga o modo)">×</button>
    </div>
    <div class="uie-sel">
      <button type="button" class="uie-pick" data-uie-pick>🎯 Selecionar elemento</button>
      <code class="uie-selector" data-uie-selector>nenhum</code>
    </div>
    <div class="uie-body" data-uie-body hidden>
      <div class="uie-row"><label>Mover X</label><input type="number" step="1" data-p="--uie-x" data-uie-move="x"><label>Y</label><input type="number" step="1" data-uie-move="y"></div>
      <div class="uie-row"><label>Largura</label><input type="text" placeholder="auto" data-uie-css="width"><label>Altura</label><input type="text" placeholder="auto" data-uie-css="height"></div>
      <div class="uie-row"><label>Margem</label><input type="text" placeholder="ex: 8px 0" data-uie-css="margin"><label>Padding</label><input type="text" data-uie-css="padding"></div>
      <div class="uie-row"><label>Fonte</label><input type="text" placeholder="14px" data-uie-css="font-size"><label>Peso</label><input type="text" placeholder="700" data-uie-css="font-weight"></div>
      <div class="uie-row"><label>Raio</label><input type="text" placeholder="12px" data-uie-css="border-radius"><label>Gap</label><input type="text" placeholder="10px" data-uie-css="gap"></div>
      <div class="uie-row"><label>Fundo</label><input type="text" placeholder="#101218 / var(--panel)" data-uie-css="background"><label>Cor</label><input type="text" placeholder="#fff" data-uie-css="color"></div>
      <div class="uie-row uie-actions">
        <button type="button" data-uie-hide>👻 Ocultar</button>
        <button type="button" data-uie-reset-el>↺ Resetar elemento</button>
      </div>
      <p class="uie-hint">Arraste o elemento pra mover · alça ◢ redimensiona · setas do teclado ajustam (Shift = 10px)</p>
    </div>
    <div class="uie-foot">
      <button type="button" data-uie-export>⬇ Exportar JSON</button>
      <button type="button" data-uie-import>⬆ Importar</button>
      <button type="button" data-uie-clear>🗑 Limpar tudo</button>
    </div>`;
  document.body.appendChild(panel);
  const $ = (q) => panel.querySelector(q);
  const bodyEl = $("[data-uie-body]");
  const selEl = $("[data-uie-selector]");

  // CSS do próprio editor (inline no JS pra não pesar o styles.css do site)
  const css = document.createElement("style");
  css.textContent = `
  #${PANEL_ID}{position:fixed;top:76px;right:16px;z-index:9999;width:290px;background:var(--panel,#181b22);border:1px solid var(--line,#2d333f);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.4);color:var(--text,#f3f5f7);font-size:12px}
  #${PANEL_ID} .uie-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:grab;border-bottom:1px solid var(--line,#2d333f)}
  #${PANEL_ID} .uie-badge{font-size:10px;background:var(--accent,#e23030);color:#fff;border-radius:999px;padding:1px 7px}
  #${PANEL_ID} .uie-x{margin-left:auto;background:none;border:none;color:inherit;font-size:16px;cursor:pointer}
  #${PANEL_ID} .uie-sel{display:flex;gap:8px;align-items:center;padding:10px 12px}
  #${PANEL_ID} .uie-pick{flex:none}
  #${PANEL_ID} .uie-selector{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#9ba4b3)}
  #${PANEL_ID} .uie-body{padding:4px 12px 8px;display:flex;flex-direction:column;gap:6px}
  #${PANEL_ID} .uie-row{display:grid;grid-template-columns:52px 1fr 44px 1fr;gap:6px;align-items:center}
  #${PANEL_ID} .uie-row label{color:var(--muted,#9ba4b3);font-size:11px}
  #${PANEL_ID} input{width:100%;box-sizing:border-box;background:var(--bg,#101218);border:1px solid var(--line,#2d333f);border-radius:6px;color:inherit;padding:4px 6px;font-size:12px}
  #${PANEL_ID} button{background:var(--bg,#101218);border:1px solid var(--line,#2d333f);border-radius:8px;color:inherit;padding:6px 8px;cursor:pointer;font-size:12px}
  #${PANEL_ID} button:hover{border-color:var(--accent,#e23030)}
  #${PANEL_ID} .uie-actions{grid-template-columns:1fr 1fr}
  #${PANEL_ID} .uie-hint{color:var(--subtle,#8891a1);font-size:10px;margin:2px 0 0}
  #${PANEL_ID} .uie-foot{display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--line,#2d333f)}
  .uie-hover-outline{outline:2px dashed var(--accent,#e23030) !important;outline-offset:2px;cursor:crosshair !important}
  .uie-selected-outline{outline:2px solid var(--accent,#e23030) !important;outline-offset:2px;position:relative}
  .uie-resize{position:fixed;width:14px;height:14px;background:var(--accent,#e23030);border-radius:3px;cursor:nwse-resize;z-index:9998}
  `;
  document.head.appendChild(css);

  // ── Helpers de override ─────────────────────────────────────────────────────
  function setProp(prop, value) {
    if (!selector) return;
    overrides[selector] = overrides[selector] || {};
    if (value === "" || value == null) delete overrides[selector][prop];
    else overrides[selector][prop] = value;
    if (!Object.keys(overrides[selector]).length) delete overrides[selector];
    save(); applyAll(); positionHandle();
  }
  const getProp = (prop) => (overrides[selector] || {})[prop] || "";

  // ── Seleção / picker ────────────────────────────────────────────────────────
  let hoverEl = null;
  function setPicking(on) {
    picking = on;
    $("[data-uie-pick]").textContent = on ? "… clique num elemento (Esc cancela)" : "🎯 Selecionar elemento";
  }
  function select(el) {
    if (selected) selected.classList.remove("uie-selected-outline");
    selected = el;
    selector = stableSelector(el);
    el.classList.add("uie-selected-outline");
    selEl.textContent = selector;
    selEl.title = selector;
    bodyEl.hidden = false;
    // preenche os campos com os overrides atuais
    panel.querySelectorAll("[data-uie-css]").forEach((inp) => { inp.value = getProp(inp.dataset.uieCss); });
    const tf = parseTransform(getProp("transform"));
    panel.querySelector('[data-uie-move="x"]').value = tf.x;
    panel.querySelector('[data-uie-move="y"]').value = tf.y;
    positionHandle();
  }
  document.addEventListener("mouseover", (e) => {
    if (!picking || panel.contains(e.target)) return;
    if (hoverEl) hoverEl.classList.remove("uie-hover-outline");
    hoverEl = e.target;
    hoverEl.classList.add("uie-hover-outline");
  }, true);
  document.addEventListener("click", (e) => {
    if (!picking || panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (hoverEl) hoverEl.classList.remove("uie-hover-outline");
    setPicking(false);
    select(e.target);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picking) { if (hoverEl) hoverEl.classList.remove("uie-hover-outline"); setPicking(false); }
    // Setas: nudge do elemento selecionado (margens não; transform, reversível)
    if (selected && !panel.contains(document.activeElement) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const tf = parseTransform(getProp("transform"));
      if (e.key === "ArrowUp") tf.y -= step;
      if (e.key === "ArrowDown") tf.y += step;
      if (e.key === "ArrowLeft") tf.x -= step;
      if (e.key === "ArrowRight") tf.x += step;
      writeTransform(tf);
    }
  });

  function parseTransform(v) {
    const m = String(v || "").match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
    return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 };
  }
  function writeTransform(tf) {
    setProp("transform", tf.x === 0 && tf.y === 0 ? "" : `translate(${tf.x}px, ${tf.y}px)`);
    panel.querySelector('[data-uie-move="x"]').value = tf.x;
    panel.querySelector('[data-uie-move="y"]').value = tf.y;
  }

  // ── Arrastar o elemento selecionado (mover) ────────────────────────────────
  let dragging = null;
  document.addEventListener("mousedown", (e) => {
    if (!selected || picking || panel.contains(e.target) || e.target.classList.contains("uie-resize")) return;
    if (e.target !== selected && !selected.contains(e.target)) return;
    const tf = parseTransform(getProp("transform"));
    dragging = { startX: e.clientX, startY: e.clientY, baseX: tf.x, baseY: tf.y };
    e.preventDefault();
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    writeTransform({ x: dragging.baseX + (e.clientX - dragging.startX), y: dragging.baseY + (e.clientY - dragging.startY) });
  });
  document.addEventListener("mouseup", () => { dragging = null; resizing = null; });

  // ── Alça de resize (canto inferior direito do selecionado) ─────────────────
  const handle = document.createElement("div");
  handle.className = "uie-resize";
  handle.hidden = true;
  document.body.appendChild(handle);
  function positionHandle() {
    if (!selected) { handle.hidden = true; return; }
    const r = selected.getBoundingClientRect();
    handle.style.left = `${r.right - 7}px`;
    handle.style.top = `${r.bottom - 7}px`;
    handle.hidden = false;
  }
  window.addEventListener("scroll", positionHandle, true);
  window.addEventListener("resize", positionHandle);
  let resizing = null;
  handle.addEventListener("mousedown", (e) => {
    if (!selected) return;
    const r = selected.getBoundingClientRect();
    resizing = { startX: e.clientX, startY: e.clientY, w: r.width, h: r.height };
    e.preventDefault(); e.stopPropagation();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const w = Math.max(20, Math.round(resizing.w + (e.clientX - resizing.startX)));
    const h = Math.max(10, Math.round(resizing.h + (e.clientY - resizing.startY)));
    overrides[selector] = overrides[selector] || {};
    overrides[selector].width = `${w}px`;
    overrides[selector].height = `${h}px`;
    save(); applyAll(); positionHandle();
    panel.querySelector('[data-uie-css="width"]').value = `${w}px`;
    panel.querySelector('[data-uie-css="height"]').value = `${h}px`;
  });

  // ── Controles do painel ─────────────────────────────────────────────────────
  panel.addEventListener("input", (e) => {
    const cssInp = e.target.closest("[data-uie-css]");
    if (cssInp) { setProp(cssInp.dataset.uieCss, cssInp.value.trim()); return; }
    const mv = e.target.closest("[data-uie-move]");
    if (mv) {
      const tf = parseTransform(getProp("transform"));
      if (mv.dataset.uieMove === "x") tf.x = Number(mv.value) || 0; else tf.y = Number(mv.value) || 0;
      writeTransform(tf);
    }
  });
  $("[data-uie-pick]").addEventListener("click", () => setPicking(!picking));
  $("[data-uie-hide]").addEventListener("click", () => setProp("display", getProp("display") === "none" ? "" : "none"));
  $("[data-uie-reset-el]").addEventListener("click", () => {
    if (!selector) return;
    delete overrides[selector];
    save(); applyAll();
    select(selected); // re-preenche os campos zerados
  });
  $("[data-uie-clear]").addEventListener("click", () => {
    if (!window.confirm("Limpar TODOS os ajustes do UI Editor?")) return;
    overrides = {}; save(); applyAll(); positionHandle();
  });
  $("[data-uie-export]").addEventListener("click", () => {
    const payload = { _tool: "sleevu-ui-editor", _version: 1, _exportedAt: new Date().toISOString(), _page: location.pathname, overrides };
    const text = JSON.stringify(payload, null, 2);
    try { navigator.clipboard.writeText(text); } catch (e) { /* sem clipboard: só o download */ }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = "ui-overrides.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("[data-uie-import]").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      f.text().then((txt) => {
        try {
          const j = JSON.parse(txt);
          overrides = j.overrides || j || {};
          save(); applyAll();
        } catch (e) { window.alert("JSON inválido."); }
      });
    };
    inp.click();
  });
  $("[data-uie-close]").addEventListener("click", () => {
    if (window.confirm("Desligar o UI Editor? (os ajustes ficam salvos; religue nas Configurações)")) {
      try { localStorage.setItem("tcg-collector-pref-ui-editor", "off"); } catch (e) { /* ignora */ }
      location.reload();
    }
  });

  // ── Painel arrastável ───────────────────────────────────────────────────────
  let panelDrag = null;
  $("[data-uie-drag]").addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    const r = panel.getBoundingClientRect();
    panelDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!panelDrag) return;
    panel.style.left = `${e.clientX - panelDrag.dx}px`;
    panel.style.top = `${e.clientY - panelDrag.dy}px`;
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => { panelDrag = null; });
})();
