import { compileTheme, listBuiltInThemes } from "./compiler.js";
import type { ResolvedTheme, ThemePackId } from "./types.js";

export interface ThemeSpecimen {
  readonly id: ThemePackId;
  readonly name: string;
  readonly description: string;
  readonly thesis: string;
  readonly motif: string;
  readonly tags: readonly string[];
  readonly fontSummary: string;
  readonly palette: readonly { readonly name: string; readonly value: string }[];
  readonly contrastMinimum: number;
  readonly sampleVariables: Readonly<Record<string, string>>;
}

export function createThemeSpecimenData(locale = "en"): readonly ThemeSpecimen[] {
  return listBuiltInThemes().map((theme) => {
    const resolved = compileTheme(theme, { locale, contrastPolicy: "reject" });
    return {
      id: resolved.id,
      name: resolved.name,
      description: resolved.description,
      thesis: resolved.visualBible.thesis,
      motif: resolved.visualBible.signatureMotif,
      tags: resolved.tags,
      fontSummary: `${resolved.typography.display.families[0]} / ${resolved.typography.body.families[0]} / ${resolved.typography.code.families[0]}`,
      palette: [
        { name: "Canvas", value: resolved.palette.canvas },
        { name: "Ink", value: resolved.palette.ink },
        { name: "Accent", value: resolved.palette.accent },
        { name: "Evidence", value: resolved.palette.evidence },
        { name: "Review", value: resolved.palette.review },
        { name: "Critical", value: resolved.palette.critical },
      ],
      contrastMinimum: resolved.contrastAudit.minimumRatio,
      sampleVariables: resolved.cssVariables,
    };
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function specimenCard(theme: ResolvedTheme): string {
  const variables = Object.entries(theme.cssVariables).map(([name, value]) => `${name}:${value}`).join(";");
  const swatches = [
    ["Canvas", theme.palette.canvas], ["Ink", theme.palette.ink], ["Accent", theme.palette.accent],
    ["Evidence", theme.palette.evidence], ["Review", theme.palette.review], ["Critical", theme.palette.critical],
  ].map(([name, value]) => `<div class="swatch" style="--swatch:${escapeHtml(value ?? "")}"><span>${escapeHtml(name ?? "")}</span><code>${escapeHtml(value ?? "")}</code></div>`).join("");

  return `<article class="theme-card" data-aly-theme="${escapeHtml(theme.id)}" style="${escapeHtml(variables)}">
  <header class="card-head">
    <div><span class="eyebrow">${escapeHtml(theme.id.replaceAll("-", " "))}</span><h2>${escapeHtml(theme.name)}</h2></div>
    <div class="ratio" title="Lowest audited contrast ratio"><strong>${theme.contrastAudit.minimumRatio.toFixed(2)}</strong><span>min contrast</span></div>
  </header>
  <p class="description">${escapeHtml(theme.description)}</p>
  <div class="teaching-frame">
    <div class="thread" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="lesson">
      <span class="utility">Visual thesis</span>
      <h3>${escapeHtml(theme.visualBible.thesis)}</h3>
      <p>${escapeHtml(theme.visualBible.audiencePromise)}</p>
      <div class="evidence"><b>Signature</b><span>${escapeHtml(theme.visualBible.signatureMotif)}</span></div>
    </div>
    <aside class="diagram" aria-label="Example concept diagram">
      <span class="node active">Question</span><span class="connector"></span><span class="node">Evidence</span><span class="connector"></span><span class="node result">Insight</span>
    </aside>
  </div>
  <div class="swatches">${swatches}</div>
  <footer><span>${escapeHtml(theme.typography.display.families[0] ?? "")}</span><span>${escapeHtml(theme.typography.body.families[0] ?? "")}</span><span>${escapeHtml(theme.motion.tempo)} motion</span></footer>
</article>`;
}

/** Creates a dependency-free specimen document suitable for a browser or screenshot harness. */
export function createThemeSpecimenHtml(locale = "en"): string {
  const themes = listBuiltInThemes().map((theme) => compileTheme(theme, { locale, contrastPolicy: "reject" }));
  const cards = themes.map(specimenCard).join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alystria Studio — Theme specimen</title>
<style>
*{box-sizing:border-box}html{background:#E9ECF4;color:#151827;font-family:"Atkinson Hyperlegible Next",Arial,sans-serif}body{margin:0;padding:56px clamp(18px,5vw,84px) 96px}.page-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:32px;max-width:1500px;margin:0 auto 44px}.page-head h1{font-family:"Bricolage Grotesque",Arial,sans-serif;font-size:clamp(2.6rem,6vw,5.8rem);line-height:.88;letter-spacing:-.055em;margin:12px 0}.page-head p{max-width:62ch;font-size:1.08rem;line-height:1.5;color:#4A5066}.page-mark{display:grid;place-items:center;width:116px;height:116px;border:1px solid #A7B0C6;border-radius:50%;font:700 12px/1 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase}.collection{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:28px;max-width:1500px;margin:auto}.theme-card{position:relative;overflow:hidden;min-height:610px;padding:32px;background:var(--aly-color-canvas);color:var(--aly-color-ink);border:var(--aly-space-border-width) solid var(--aly-color-line);border-radius:var(--aly-space-radius-large);box-shadow:0 16px var(--aly-space-shadow-blur) color-mix(in srgb,var(--aly-color-shadow) 14%,transparent);font-family:var(--aly-font-body)}.card-head{display:flex;align-items:start;justify-content:space-between;gap:24px}.eyebrow,.utility{display:block;font-family:var(--aly-font-utility);font-size:.7rem;font-weight:var(--aly-font-utility-weight);line-height:1.2;letter-spacing:.08em;text-transform:uppercase;color:var(--aly-color-accent)}h2,h3,p{margin-top:0}.card-head h2{font-family:var(--aly-font-display);font-size:2.55rem;line-height:.96;letter-spacing:var(--aly-font-display-tracking);margin:8px 0 0}.ratio{display:flex;flex-direction:column;align-items:end;text-align:right}.ratio strong{font:650 1rem/1 var(--aly-font-code)}.ratio span{margin-top:4px;font-size:.7rem;color:var(--aly-color-ink-muted)}.description{max-width:66ch;color:var(--aly-color-ink-muted);line-height:1.48;margin:18px 0 28px}.teaching-frame{position:relative;display:grid;grid-template-columns:20px minmax(0,1fr);gap:18px;min-height:270px;padding:26px;background:var(--aly-color-surface);border:1px solid var(--aly-color-line);border-radius:var(--aly-space-radius-medium)}.thread{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:5px 0}.thread:before{content:"";position:absolute;inset:8px auto;width:2px;background:var(--aly-color-accent)}.thread i{z-index:1;width:10px;height:10px;border:2px solid var(--aly-color-accent);border-radius:50%;background:var(--aly-color-surface)}.lesson{min-width:0}.lesson h3{max-width:15ch;margin:8px 0 10px;font-family:var(--aly-font-heading);font-size:1.45rem;line-height:1.08}.lesson p{color:var(--aly-color-ink-muted);line-height:1.45;max-width:46ch}.evidence{display:grid;grid-template-columns:auto 1fr;gap:9px;padding:10px 12px;border-left:3px solid var(--aly-color-evidence);background:var(--aly-color-accent-soft);font-size:.78rem;line-height:1.35}.evidence b{color:var(--aly-color-evidence)}.diagram{grid-column:2;display:flex;align-items:center;margin-top:20px;overflow:hidden}.node{flex:0 1 auto;padding:7px 10px;border:1px solid var(--aly-color-line-strong);border-radius:var(--aly-space-radius-small);font-size:.72rem;font-weight:700}.node.active{border-color:var(--aly-color-accent);background:var(--aly-color-accent);color:var(--aly-color-on-accent)}.node.result{border-color:var(--aly-color-evidence);color:var(--aly-color-evidence)}.connector{flex:1 1 18px;min-width:10px;height:2px;background:var(--aly-color-line-strong)}.swatches{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:18px}.swatch{min-width:0;height:76px;padding:9px;background:var(--swatch);border:1px solid color-mix(in srgb,var(--aly-color-ink) 16%,transparent);border-radius:var(--aly-space-radius-small);display:flex;flex-direction:column;justify-content:space-between}.swatch span,.swatch code{width:max-content;max-width:100%;padding:2px 4px;background:var(--aly-color-surface);color:var(--aly-color-ink);font-size:.56rem;overflow:hidden}.swatch code{font-family:var(--aly-font-code)}footer{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:18px;padding-top:14px;border-top:1px solid var(--aly-color-line);color:var(--aly-color-ink-muted);font-size:.7rem}footer span:not(:last-child):after{content:" ·";color:var(--aly-color-accent)}
@media(max-width:680px){html,body{max-width:100%;overflow-x:hidden}body{padding:28px 12px 64px}.page-head,.collection{grid-template-columns:minmax(0,1fr);min-width:0}.page-mark,.ratio{display:none}.theme-card{width:100%;min-width:0;min-height:0;padding:22px}.card-head,.lesson,.evidence,footer{min-width:0}.description,.lesson h3,.lesson p,.evidence span,footer span{overflow-wrap:anywhere}.evidence{grid-template-columns:1fr}.swatches{grid-template-columns:repeat(3,minmax(0,1fr))}.teaching-frame{padding:20px 16px}.card-head h2{font-size:2.1rem}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation:none!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<header class="page-head"><div><span class="eyebrow">Alystria Studio 2.0</span><h1>Ten visual<br>bibles, one system.</h1><p>Built-in theme packs are authored as teaching languages—not color presets. This specimen exercises type, semantic color, evidence treatment, diagrams, spacing, and the concept thread.</p></div><div class="page-mark">Theme<br>Specimen</div></header>
<main class="collection">${cards}</main>
</body></html>`;
}
