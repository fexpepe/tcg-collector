(function () {
  // ═══════════════════════════════════════════════════════════════════════════
  // UI EDITOR (experimental, só em modo de teste)
  //
  // Ferramenta de design AO VIVO com ESTRUTURA:
  //  - Grade de alinhamento (passo configurável, padrão 8px) com SNAP no
  //    arrastar/redimensionar;
  //  - Guias estruturais do site (trilhos do conteúdo --content-w, linha
  //    central, base do header) com snap magnético e flash da guia;
  //  - "Conter nos limites": o elemento não sai dos trilhos do conteúdo;
  //  - 🔒 Travar (elemento não move/edita) e 📌 Fixar (position sticky).
  //
  // Overrides em localStorage -> <style> com !important; [Exportar JSON] baixa
  // ui-overrides.json pro Claude converter em CSS definitivo no styles.css.
  // Ativação: Configurações -> "UI Editor" ou ?uieditor=1 (shared.js injeta).
  // ═══════════════════════════════════════════════════════════════════════════
  const STORE_KEY = "tcg-ui-editor-overrides-v1";
  const PREFS_KEY = "tcg-ui-editor-prefs-v1";
  const PANEL_ID = "uiEditorPanel";
  if (document.getElementById(PANEL_ID)) return;

  // ── Estado ──────────────────────────────────────────────────────────────────
  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { overrides = {}; }
  let prefs = { grid: false, step: 8, guides: true, snap: true, clamp: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}); } catch (e) { /* padrão */ }
  let selected = null;
  let selector = "";
  let picking = false;
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(overrides)); } catch (e) { /* quota */ } };
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* quota */ } };

  // ── Overrides -> <style> (chaves "__meta" ficam só no JSON, fora do CSS) ───
  const styleEl = document.createElement("style");
  styleEl.id = "uiEditorOverrides";
  document.head.appendChild(styleEl);
  function applyAll() {
    styleEl.textContent = Object.entries(overrides).map(([sel, props]) => {
      const body = Object.entries(props)
        .filter(([k]) => !k.startsWith("__"))
        .map(([k, v]) => `${k}: ${v} !important;`).join(" ");
      return body ? `${sel} { ${body} }` : "";
    }).join("\n");
  }
  applyAll();

  // ── Seletor estável ─────────────────────────────────────────────────────────
  const IGNORE_CLASSES = /^(active|owned|wanted|added|is-|has-|hidden)/;
  function stableSelector(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 4) {
      if (node.id && !/^(radix|__)/.test(node.id)) { parts.unshift(`#${node.id}`); break; }
      const cls = Array.from(node.classList).filter((c) => !IGNORE_CLASSES.test(c));
      let part = node.tagName.toLowerCase();
      if (cls.length) part += `.${cls[0]}`;
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

  // ── Estrutura: grade + guias + trilhos ──────────────────────────────────────
  // Trilhos = a caixa real do <main> (que herda --content-w do site). É a
  // "barreira padrão" da estrutura: colunas, centro e limites vêm dela.
  const contentBox = () => {
    const m = document.querySelector("main") || document.body;
    return m.getBoundingClientRect();
  };
  const headerBottom = () => {
    const h = document.querySelector(".app-header");
    return h ? h.getBoundingClientRect().bottom : 0;
  };

  const gridEl = document.createElement("div");
  gridEl.id = "uieGrid";
  gridEl.hidden = true;
  document.body.appendChild(gridEl);
  const colsEl = document.createElement("div");
  colsEl.id = "uieCols";
  colsEl.hidden = true;
  colsEl.innerHTML = new Array(12).fill('<span></span>').join("");
  document.body.appendChild(colsEl);

  function renderStructure() {
    // grade fina (passo) cobrindo a viewport
    gridEl.hidden = !prefs.grid;
    colsEl.hidden = !prefs.grid;
    if (prefs.grid) {
      const s = Math.max(2, Number(prefs.step) || 8);
      gridEl.style.backgroundSize = `${s}px ${s}px`;
      // 12 colunas dentro dos trilhos do conteúdo
      const r = contentBox();
      colsEl.style.left = `${r.left}px`;
      colsEl.style.width = `${r.width}px`;
    }
  }
  window.addEventListener("resize", renderStructure);
  window.addEventListener("scroll", () => { if (prefs.grid) renderStructure(); }, true);

  // Linha de guia que ACENDE ao encaixar (vertical ou horizontal)
  const guideLine = document.createElement("div");
  guideLine.id = "uieGuide";
  guideLine.hidden = true;
  document.body.appendChild(guideLine);
  let guideTimer = 0;
  function flashGuide(orientation, pos) {
    guideLine.hidden = false;
    if (orientation === "v") {
      guideLine.style.cssText = `left:${pos}px;top:0;width:1px;height:100vh;`;
    } else {
      guideLine.style.cssText = `left:0;top:${pos}px;width:100vw;height:1px;`;
    }
    clearTimeout(guideTimer);
    guideTimer = window.setTimeout(() => { guideLine.hidden = true; }, 350);
  }

  // Snap de uma posição-alvo: 1º nas guias estruturais (magnético, ±6px),
  // depois no passo da grade. Retorna { v, guided }.
  const SNAP_T = 6;
  function snapX(left, width) {
    if (!prefs.snap) return { v: left, guided: false };
    const r = contentBox();
    const guides = [r.left, r.right, r.left + r.width / 2];
    const edges = [left, left + width, left + width / 2]; // borda esq, dir, centro
    if (prefs.guides) {
      for (const g of guides) {
        for (let i = 0; i < edges.length; i++) {
          if (Math.abs(edges[i] - g) <= SNAP_T) {
            const corrected = i === 0 ? g : i === 1 ? g - width : g - width / 2;
            flashGuide("v", g);
            return { v: corrected, guided: true };
          }
        }
      }
    }
    if (prefs.grid) { const s = Math.max(2, Number(prefs.step) || 8); return { v: Math.round(left / s) * s, guided: false }; }
    return { v: left, guided: false };
  }
  function snapY(top, height) {
    if (!prefs.snap) return { v: top, guided: false };
    const hb = headerBottom();
    if (prefs.guides && Math.abs(top - hb) <= SNAP_T) { flashGuide("h", hb); return { v: hb, guided: true }; }
    if (prefs.grid) { const s = Math.max(2, Number(prefs.step) || 8); return { v: Math.round(top / s) * s, guided: false }; }
    return { v: top, guided: false };
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
    <div class="uie-struct">
      <label class="uie-chk"><input type="checkbox" data-uie-pref="grid"> Grade</label>
      <input type="number" min="2" max="64" step="1" class="uie-step" data-uie-step title="Passo da grade (px)">
      <label class="uie-chk"><input type="checkbox" data-uie-pref="guides"> Guias</label>
      <label class="uie-chk"><input type="checkbox" data-uie-pref="snap"> Snap</label>
      <label class="uie-chk" title="Elemento não sai dos trilhos do conteúdo"><input type="checkbox" data-uie-pref="clamp"> Conter</label>
    </div>
    <div class="uie-sel">
      <button type="button" class="uie-pick" data-uie-pick>🎯 Selecionar elemento</button>
      <code class="uie-selector" data-uie-selector>nenhum</code>
    </div>
    <div class="uie-body" data-uie-body hidden>
      <div class="uie-row"><label>Mover X</label><input type="number" step="1" data-uie-move="x"><label>Y</label><input type="number" step="1" data-uie-move="y"></div>
      <div class="uie-row"><label>Largura</label><input type="text" placeholder="auto" data-uie-css="width"><label>Altura</label><input type="text" placeholder="auto" data-uie-css="height"></div>
      <div class="uie-row"><label>Margem</label><input type="text" placeholder="ex: 8px 0" data-uie-css="margin"><label>Padding</label><input type="text" data-uie-css="padding"></div>
      <div class="uie-row"><label>Fonte</label><input type="text" placeholder="14px" data-uie-css="font-size"><label>Peso</label><input type="text" placeholder="700" data-uie-css="font-weight"></div>
      <div class="uie-row"><label>Raio</label><input type="text" placeholder="12px" data-uie-css="border-radius"><label>Gap</label><input type="text" placeholder="10px" data-uie-css="gap"></div>
      <div class="uie-row"><label>Fundo</label><input type="text" placeholder="#101218 / var(--panel)" data-uie-css="background"><label>Cor</label><input type="text" placeholder="#fff" data-uie-css="color"></div>
      <div class="uie-row uie-actions">
        <button type="button" data-uie-lock>🔒 Travar</button>
        <button type="button" data-uie-pin title="position: sticky abaixo do header">📌 Fixar</button>
        <button type="button" data-uie-hide>👻 Ocultar</button>
        <button type="button" data-uie-reset-el>↺ Resetar</button>
      </div>
      <p class="uie-hint">Arraste pra mover (snap na grade/guias) · alça ◢ redimensiona · setas ajustam (Shift = 10px)</p>
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

  const css = document.createElement("style");
  css.textContent = `
  #${PANEL_ID}{position:fixed;top:76px;right:16px;z-index:9999;width:300px;background:var(--panel,#181b22);border:1px solid var(--line,#2d333f);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.4);color:var(--text,#f3f5f7);font-size:12px}
  #${PANEL_ID} .uie-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:grab;border-bottom:1px solid var(--line,#2d333f)}
  #${PANEL_ID} .uie-badge{font-size:10px;background:var(--accent,#e23030);color:#fff;border-radius:999px;padding:1px 7px}
  #${PANEL_ID} .uie-x{margin-left:auto;background:none;border:none;color:inherit;font-size:16px;cursor:pointer}
  #${PANEL_ID} .uie-struct{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--line,#2d333f)}
  #${PANEL_ID} .uie-chk{display:inline-flex;align-items:center;gap:4px;color:var(--muted,#9ba4b3);cursor:pointer;user-select:none}
  #${PANEL_ID} .uie-step{width:44px}
  #${PANEL_ID} .uie-sel{display:flex;gap:8px;align-items:center;padding:10px 12px}
  #${PANEL_ID} .uie-selector{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#9ba4b3)}
  #${PANEL_ID} .uie-body{padding:4px 12px 8px;display:flex;flex-direction:column;gap:6px}
  #${PANEL_ID} .uie-row{display:grid;grid-template-columns:52px 1fr 44px 1fr;gap:6px;align-items:center}
  #${PANEL_ID} .uie-row label{color:var(--muted,#9ba4b3);font-size:11px}
  #${PANEL_ID} input{box-sizing:border-box;background:var(--bg,#101218);border:1px solid var(--line,#2d333f);border-radius:6px;color:inherit;padding:4px 6px;font-size:12px;width:100%}
  #${PANEL_ID} input[type=checkbox]{width:auto}
  #${PANEL_ID} button{background:var(--bg,#101218);border:1px solid var(--line,#2d333f);border-radius:8px;color:inherit;padding:6px 8px;cursor:pointer;font-size:12px}
  #${PANEL_ID} button:hover{border-color:var(--accent,#e23030)}
  #${PANEL_ID} .uie-actions{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px}
  #${PANEL_ID} .uie-actions .on{border-color:var(--accent,#e23030);background:rgba(226,48,48,.12)}
  #${PANEL_ID} .uie-hint{color:var(--subtle,#8891a1);font-size:10px;margin:2px 0 0}
  #${PANEL_ID} .uie-foot{display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--line,#2d333f)}
  .uie-hover-outline{outline:2px dashed var(--accent,#e23030) !important;outline-offset:2px;cursor:crosshair !important}
  .uie-selected-outline{outline:2px solid var(--accent,#e23030) !important;outline-offset:2px}
  .uie-locked-outline{outline:2px solid #8891a1 !important;outline-offset:2px}
  .uie-resize{position:fixed;width:14px;height:14px;background:var(--accent,#e23030);border-radius:3px;cursor:nwse-resize;z-index:9998}
  #uieGrid{position:fixed;inset:0;z-index:9990;pointer-events:none;background-image:linear-gradient(to right, rgba(138,145,161,.14) 1px, transparent 1px),linear-gradient(to bottom, rgba(138,145,161,.14) 1px, transparent 1px)}
  #uieCols{position:fixed;top:0;height:100vh;z-index:9990;pointer-events:none;display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
  #uieCols span{background:rgba(226,48,48,.05);border-left:1px solid rgba(226,48,48,.14);border-right:1px solid rgba(226,48,48,.14)}
  #uieGuide{position:fixed;z-index:9995;pointer-events:none;background:var(--accent,#e23030);box-shadow:0 0 6px var(--accent,#e23030)}
  `;
  document.head.appendChild(css);

  // prefs -> UI
  panel.querySelectorAll("[data-uie-pref]").forEach((chk) => {
    chk.checked = !!prefs[chk.dataset.uiePref];
    chk.addEventListener("change", () => { prefs[chk.dataset.uiePref] = chk.checked; savePrefs(); renderStructure(); });
  });
  const stepInp = $("[data-uie-step]");
  stepInp.value = prefs.step;
  stepInp.addEventListener("input", () => { prefs.step = Math.max(2, Number(stepInp.value) || 8); savePrefs(); renderStructure(); });
  renderStructure();

  // ── Helpers de override ─────────────────────────────────────────────────────
  function setProp(prop, value) {
    if (!selector) return;
    overrides[selector] = overrides[selector] || {};
    if (value === "" || value == null || value === false) delete overrides[selector][prop];
    else overrides[selector][prop] = value;
    if (!Object.keys(overrides[selector]).length) delete overrides[selector];
    save(); applyAll(); positionHandle();
  }
  const getProp = (prop) => (overrides[selector] || {})[prop] || "";
  const isLocked = () => getProp("__locked") === true;

  // ── Seleção / picker ────────────────────────────────────────────────────────
  let hoverEl = null;
  function setPicking(on) {
    picking = on;
    $("[data-uie-pick]").textContent = on ? "… clique num elemento (Esc cancela)" : "🎯 Selecionar elemento";
  }
  function syncActionButtons() {
    $("[data-uie-lock]").classList.toggle("on", isLocked());
    $("[data-uie-lock]").textContent = isLocked() ? "🔓 Destravar" : "🔒 Travar";
    $("[data-uie-pin]").classList.toggle("on", getProp("position") === "sticky");
    $("[data-uie-hide]").classList.toggle("on", getProp("display") === "none");
    if (selected) {
      selected.classList.toggle("uie-locked-outline", isLocked());
      selected.classList.toggle("uie-selected-outline", !isLocked());
    }
  }
  function select(el) {
    if (selected) selected.classList.remove("uie-selected-outline", "uie-locked-outline");
    selected = el;
    selector = stableSelector(el);
    selEl.textContent = selector;
    selEl.title = selector;
    bodyEl.hidden = false;
    panel.querySelectorAll("[data-uie-css]").forEach((inp) => { inp.value = getProp(inp.dataset.uieCss); });
    const tf = parseTransform(getProp("transform"));
    panel.querySelector('[data-uie-move="x"]').value = tf.x;
    panel.querySelector('[data-uie-move="y"]').value = tf.y;
    syncActionButtons();
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
    if (selected && !isLocked() && !panel.contains(document.activeElement) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
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

  // ── Arrastar com SNAP (grade + guias) e CONTENÇÃO nos trilhos ──────────────
  let dragging = null;
  document.addEventListener("mousedown", (e) => {
    if (!selected || picking || isLocked() || panel.contains(e.target) || e.target.classList.contains("uie-resize")) return;
    if (e.target !== selected && !selected.contains(e.target)) return;
    const tf = parseTransform(getProp("transform"));
    const r = selected.getBoundingClientRect();
    // base = rect SEM o transform atual (pra converter posição desejada em delta)
    dragging = { startX: e.clientX, startY: e.clientY, baseX: tf.x, baseY: tf.y, left0: r.left - tf.x, top0: r.top - tf.y, w: r.width, h: r.height };
    e.preventDefault();
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (dragging) {
      let x = dragging.baseX + (e.clientX - dragging.startX);
      let y = dragging.baseY + (e.clientY - dragging.startY);
      // posição-alvo na viewport -> snap -> volta pra delta
      const sx = snapX(dragging.left0 + x, dragging.w);
      const sy = snapY(dragging.top0 + y, dragging.h);
      x = Math.round(sx.v - dragging.left0);
      y = Math.round(sy.v - dragging.top0);
      // contenção nos trilhos do conteúdo
      if (prefs.clamp) {
        const r = contentBox();
        const minX = Math.round(r.left - dragging.left0);
        const maxX = Math.round(r.right - dragging.w - dragging.left0);
        x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
      }
      writeTransform({ x, y });
    }
    if (resizing) {
      let w = Math.max(20, Math.round(resizing.w + (e.clientX - resizing.startX)));
      let h = Math.max(10, Math.round(resizing.h + (e.clientY - resizing.startY)));
      if (prefs.grid && prefs.snap) {
        const s = Math.max(2, Number(prefs.step) || 8);
        w = Math.round(w / s) * s;
        h = Math.round(h / s) * s;
      }
      // borda direita pode grudar nos trilhos
      if (prefs.guides && prefs.snap) {
        const r = contentBox();
        if (Math.abs((resizing.left + w) - r.right) <= SNAP_T) { w = Math.round(r.right - resizing.left); flashGuide("v", r.right); }
      }
      overrides[selector] = overrides[selector] || {};
      overrides[selector].width = `${w}px`;
      overrides[selector].height = `${h}px`;
      save(); applyAll(); positionHandle();
      panel.querySelector('[data-uie-css="width"]').value = `${w}px`;
      panel.querySelector('[data-uie-css="height"]').value = `${h}px`;
    }
  });
  document.addEventListener("mouseup", () => { dragging = null; resizing = null; });

  // ── Alça de resize ──────────────────────────────────────────────────────────
  const handle = document.createElement("div");
  handle.className = "uie-resize";
  handle.hidden = true;
  document.body.appendChild(handle);
  function positionHandle() {
    if (!selected || isLocked()) { handle.hidden = true; return; }
    const r = selected.getBoundingClientRect();
    handle.style.left = `${r.right - 7}px`;
    handle.style.top = `${r.bottom - 7}px`;
    handle.hidden = false;
  }
  window.addEventListener("scroll", positionHandle, true);
  window.addEventListener("resize", positionHandle);
  let resizing = null;
  handle.addEventListener("mousedown", (e) => {
    if (!selected || isLocked()) return;
    const r = selected.getBoundingClientRect();
    resizing = { startX: e.clientX, startY: e.clientY, w: r.width, h: r.height, left: r.left };
    e.preventDefault(); e.stopPropagation();
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
  $("[data-uie-lock]").addEventListener("click", () => { setProp("__locked", isLocked() ? "" : true); syncActionButtons(); positionHandle(); });
  $("[data-uie-pin]").addEventListener("click", () => {
    if (getProp("position") === "sticky") {
      setProp("position", ""); setProp("top", ""); setProp("z-index", "");
    } else {
      // fixa logo abaixo do header (sticky mantém o fluxo; o valor fica editável)
      setProp("position", "sticky");
      setProp("top", `${Math.max(0, Math.round(headerBottom()))}px`);
      setProp("z-index", "50");
    }
    syncActionButtons();
  });
  $("[data-uie-hide]").addEventListener("click", () => { setProp("display", getProp("display") === "none" ? "" : "none"); syncActionButtons(); });
  $("[data-uie-reset-el]").addEventListener("click", () => {
    if (!selector) return;
    delete overrides[selector];
    save(); applyAll();
    select(selected);
  });
  $("[data-uie-clear]").addEventListener("click", () => {
    if (!window.confirm("Limpar TODOS os ajustes do UI Editor?")) return;
    overrides = {}; save(); applyAll(); positionHandle();
    if (selected) select(selected);
  });
  $("[data-uie-export]").addEventListener("click", () => {
    const payload = { _tool: "sleevu-ui-editor", _version: 2, _exportedAt: new Date().toISOString(), _page: location.pathname, _prefs: prefs, overrides };
    const text = JSON.stringify(payload, null, 2);
    try { navigator.clipboard.writeText(text); } catch (e) { /* sem clipboard */ }
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
