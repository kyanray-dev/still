import './style.css';
import arrowDown from '@phosphor-icons/core/assets/regular/arrow-down.svg?raw';
import arrowUpRight from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import moon from '@phosphor-icons/core/assets/regular/moon.svg?raw';
import sun from '@phosphor-icons/core/assets/regular/sun.svg?raw';
import appleLogo from '@phosphor-icons/core/assets/regular/apple-logo.svg?raw';
import windowsLogo from '@phosphor-icons/core/assets/regular/windows-logo.svg?raw';
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';

const icons = { arrowDown, arrowUpRight, moon, sun, appleLogo, windowsLogo, plus };
for (const element of document.querySelectorAll('[data-icon]')) {
  const markup = icons[element.dataset.icon];
  if (markup) element.innerHTML = markup;
}

const root = document.documentElement;
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const themeButton = document.querySelector('.theme-toggle');
const motionButton = document.querySelector('#motion-toggle');
const sceneHost = document.querySelector('#paper-scene');
const ambientHost = document.querySelector('#ambient-background');
const preview = document.querySelector('#product-preview');
let scene;
let ambientScene;
let disposed = false;
let idleHandle;
let timerHandle;
let paused = false;
let themePreference;
try { themePreference = localStorage.getItem('still-site-theme'); } catch { /* Storage is optional. */ }

function isDark() { return themePreference === 'dark' || (themePreference !== 'light' && themeQuery.matches); }
function applyTheme() {
  const dark = isDark();
  if (themePreference === 'light' || themePreference === 'dark') root.dataset.theme = themePreference;
  else delete root.dataset.theme;
  themeButton.innerHTML = dark ? sun : moon;
  themeButton.setAttribute('aria-label', dark ? '切换到浅色外观' : '切换到深色外观');
  themeButton.title = dark ? '切换到浅色外观' : '切换到深色外观';
  preview.src = dark ? '/wysiwyg-dark.png' : '/wysiwyg-light.png';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#171b19' : '#f8f9f7';
  scene?.setTheme(dark);
  ambientScene?.setTheme(dark);
}
themeButton.hidden = false;
function toggleTheme() {
  themePreference = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('still-site-theme', themePreference); } catch { /* Storage is optional. */ }
  applyTheme();
}
themeButton.addEventListener('click', toggleTheme);
themeQuery.addEventListener('change', applyTheme);
applyTheme();

const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
const download = document.querySelector('#recommended-download');
const label = document.querySelector('#recommended-label');
if (/win/i.test(platform)) {
  download.href = '/downloads/Still-1.2.0-Windows-x64-Setup.exe';
  download.setAttribute('download', '');
  label.textContent = '下载 Windows 版';
} else if (/mac/i.test(platform) && navigator.maxTouchPoints < 2) {
  download.href = '/downloads/Still-1.2.1-macOS-universal.dmg';
  download.setAttribute('download', '');
  label.textContent = '下载 macOS 版';
}

function applyMotionPreference() {
  scene?.setPaused?.(paused || reducedMotion.matches);
  ambientScene?.setPaused?.(paused || reducedMotion.matches);
  const available = sceneHost.dataset.sceneState === 'ready' || ambientHost.dataset.sceneState === 'ready';
  motionButton.hidden = !available || reducedMotion.matches;
  motionButton.textContent = paused ? '开启动效' : '暂停动效';
  motionButton.setAttribute('aria-pressed', String(paused));
}
function toggleMotion() { paused = !paused; applyMotionPreference(); }
motionButton.addEventListener('click', toggleMotion);
reducedMotion.addEventListener('change', applyMotionPreference);

async function startScene() {
  // Independent initialization keeps either artwork available if the other fails.
  await Promise.allSettled([
    (async () => {
      try {
        const { mountPaperScene } = await import('./paper.js');
        if (disposed) return;
        scene = mountPaperScene(sceneHost);
        applyTheme();
        applyMotionPreference();
      } catch { if (!disposed) sceneHost.dataset.sceneState = 'fallback'; }
    })(),
    (async () => {
      try {
        const { mountAmbientScene } = await import('./ambient.js');
        if (disposed) return;
        ambientScene = mountAmbientScene(ambientHost);
        applyTheme();
        applyMotionPreference();
      } catch { if (!disposed) ambientHost.dataset.sceneState = 'fallback'; }
    })(),
  ]);
}
// Content and download links are usable before either decorative scene loads.
if ('requestIdleCallback' in window) idleHandle = requestIdleCallback(() => void startScene(), { timeout: 900 });
else timerHandle = setTimeout(() => void startScene(), 120);

function stop() {
  if (disposed) return;
  disposed = true;
  if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
  if (timerHandle !== undefined) clearTimeout(timerHandle);
  scene?.dispose();
  ambientScene?.dispose();
  themeQuery.removeEventListener('change', applyTheme);
  reducedMotion.removeEventListener('change', applyMotionPreference);
  themeButton.removeEventListener('click', toggleTheme);
  motionButton.removeEventListener('click', toggleMotion);
  window.removeEventListener('pagehide', onPageHide);
}
function onPageHide(event) { if (!event.persisted) stop(); }
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(stop);
