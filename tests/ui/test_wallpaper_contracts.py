"""Wallpaper history uses the existing Panel data directory with bounded retention."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]

def source(path):
    return (ROOT / path).read_text(encoding="utf-8")

class WallpaperContracts(unittest.TestCase):
    def test_archive_before_replacement_and_bounded_storage(self):
        cs=source("YrmPanel/Services/PanelSettingsStore.cs")
        self.assertIn('ArchiveCurrentWallpaper();', cs)
        self.assertIn('Where(p => IsWallpaperHistoryId', cs)
        self.assertIn('.Skip(10)', cs)
        self.assertIn('Path.Combine(_root, "wallpaper-history")', cs)
    def test_recently_used_click_to_apply_and_private_image_handler(self):
        view = source("YrmPanel/Pages/Settings.cshtml")
        model = source("YrmPanel/Pages/Settings.cshtml.cs")

        self.assertIn('<h4>Recently Used</h4>', view)
        self.assertIn('class="yrm-wallpaper-recent-item"', view)
        self.assertIn('asp-page-handler="RestoreWallpaperHistory"', view)
        self.assertNotIn('asp-page-handler="DeleteWallpaperHistory"', view)

        self.assertIn('OnPostRestoreWallpaperHistoryAsync', model)
        self.assertIn('OnGetWallpaperHistoryImage', model)
        self.assertIn('Cache-Control', model)

if __name__ == '__main__':
    unittest.main()
