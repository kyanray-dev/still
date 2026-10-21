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
const preview = document.querySelector('#product-preview');
let scene;
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
}
themeButton.hidden = false;
themeButton.addEventListener('click', () => {
  themePreference = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('still-site-theme', themePreference); } catch { /* Storage is optional. */ }
  applyTheme();
});
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
  motionButton.hidden = !scene || reducedMotion.matches || sceneHost.dataset.sceneState === 'fallback';
  motionButton.textContent = paused ? '开启动效' : '暂停动效';
  motionButton.setAttribute('aria-pressed', String(paused));
}
motionButton.addEventListener('click', () => { paused = !paused; applyMotionPreference(); });
reducedMotion.addEventListener('change', applyMotionPreference);

async function startScene() {
  try {
    const { mountPaperScene } = await import('./paper.js');
    scene = await mountPaperScene(sceneHost);
    applyTheme();
    applyMotionPreference();
  } catch {
    sceneHost.dataset.sceneState = 'fallback';
  }
}
// Keep the useful HTML and download links independent from the 3D scene.
if ('requestIdleCallback' in window) requestIdleCallback(() => void startScene(), { timeout: 900 });
else setTimeout(() => void startScene(), 120);

const stop = () => { scene?.dispose(); themeQuery.removeEventListener('change', applyTheme); reducedMotion.removeEventListener('change', applyMotionPreference); };
window.addEventListener('pagehide', event => { if (!event.persisted) stop(); });
if (import.meta.hot) import.meta.hot.dispose(stop);
