"""Contracts for the URL-preview guard, stable window/wallpaper and fluid Network cards.
Source checks only; the browser behaviour is covered by tests/e2e/files-e2e.mjs."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class LinkGuardWindowWallpaper(unittest.TestCase):
    def test_one_link_guard_replaces_the_scattered_sanitizers(self):
        panel=source('YrmPanel/wwwroot/js/panel.js')
        for gone in ('sanitizeFilesLinks','sanitizeDesktopLinks','yrm-panel:files-view-changed'):
            self.assertNotIn(gone,panel)
        for needle in ('function guardLink(a)','new MutationObserver(records','startLinkGuard();',
                       'data-yrm-download','data-yrm-external','data-yrm-open',
                       "window.open(raw, '_blank', 'noopener,noreferrer')",
                       'function activateGuardedLink(el)','function linkRoute(a)'):
            self.assertIn(needle,panel)
        # Downloads stay natively streamed: never read a whole file into memory.
        self.assertNotIn('createObjectURL',panel)
        # Nothing may read a stripped href property any more.
        self.assertNotIn('link.href',panel)
    def test_window_bounds_are_never_rewritten_by_a_viewport_change(self):
        panel=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('function reachableBounds(bounds)',panel)
        self.assertNotIn('applyWindowBounds(true)',panel)
        self.assertNotIn('clampWindowPosition',panel)
        self.assertNotIn("appWindow.addEventListener('pointerup',()=>storeWindowBounds())",panel)
        self.assertEqual(panel.count('storeWindowBounds(true);'),2)
        self.assertIn('windowBounds.set(key,bounds);',panel)
    def test_wallpaper_is_sized_from_the_screen(self):
        css=source('YrmPanel/wwwroot/css/desktop.css')
        panel=source('YrmPanel/wwwroot/js/panel.js')
        self.assertIn('width: var(--yrm-screen-w, 100%); height: var(--yrm-screen-h, 100%)',css)
        self.assertIn('a[role="link"]:not([href]) { cursor: pointer; }',css)
        self.assertIn("'--yrm-screen-w'",panel)
        self.assertIn("window.addEventListener('resize', syncWallpaperBox);",panel)
    def test_network_cards_fill_the_window_instead_of_a_fixed_compaction(self):
        css=source('YrmPanel/wwwroot/css/v1-stability.css')
        self.assertNotIn('yrm-settings-window',css)
        self.assertIn('.server-settings-content:has(>.yrm-network-layout){display:flex;flex-direction:column;}',css)
        self.assertIn('.yrm-network-family:not(.yrm-network-interface-details){flex:1 1 auto;}',css)
        self.assertIn('#window-scroll:has(.settings-rc41){display:flex;flex-direction:column;overflow:hidden;}',css)
if __name__=='__main__':unittest.main()
