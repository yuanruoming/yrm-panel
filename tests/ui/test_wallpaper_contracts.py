"""Wallpaper gallery contracts; image behavior is exercised by FileCopySmoke."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


class WallpaperContracts(unittest.TestCase):
    def test_history_public_contract(self):
        store = source("YrmPanel/Services/PanelSettingsStore.cs")
        # Implementation and deduplication are verified by the Linux FileCopySmoke.
        # Do not assert how LINQ filters/retention are spelled in C#.
        for contract in (
            'wallpaper-history',
            'ListWallpaperHistory(',
            'ArchiveCurrentWallpaper(',
            'RestoreWallpaperHistoryAsync(',
            'PruneWallpaperHistory(',
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, store)

    def test_recently_used_click_to_apply_and_private_image_handler(self):
        view = source("YrmPanel/Pages/Settings.cshtml")
        model = source("YrmPanel/Pages/Settings.cshtml.cs")
        self.assertIn('<h4>Recently Used</h4>', view)
        self.assertIn('class="yrm-wallpaper-recent-item"', view)
        self.assertIn('asp-page-handler="RestoreWallpaperHistory"', view)
        self.assertNotIn('asp-page-handler="DeleteWallpaperHistory"', view)
        self.assertIn('OnPostRestoreWallpaperHistoryAsync(', model)
        self.assertIn('OnGetWallpaperHistoryImage(', model)
        self.assertIn('Cache-Control', model)


if __name__ == '__main__':
    unittest.main()
