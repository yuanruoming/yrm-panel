"""Ensure Settings Razor and its PageModel/Store stay in sync after UI merges."""
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]


class WallpaperHistoryContracts(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.view = (ROOT / 'YrmPanel/Pages/Settings.cshtml').read_text(encoding='utf-8')
        cls.model = (ROOT / 'YrmPanel/Pages/Settings.cshtml.cs').read_text(encoding='utf-8')
        cls.store = (ROOT / 'YrmPanel/Services/PanelSettingsStore.cs').read_text(encoding='utf-8')

    def test_wallpaper_history_model_property_exists(self):
        self.assertIn('Model.WallpaperHistory', self.view)
        self.assertIn('IReadOnlyList<PanelSettingsStore.WallpaperHistoryItem> WallpaperHistory', self.model)
        self.assertIn('ListWallpaperHistory()', self.store)

    def test_wallpaper_history_endpoints_exist(self):
        for handler, model_method, store_method in (
            ('WallpaperHistoryImage', 'OnGetWallpaperHistoryImage(', 'FindWallpaperHistoryImage('),
            ('RestoreWallpaperHistory', 'OnPostRestoreWallpaperHistoryAsync(', 'RestoreWallpaperHistoryAsync('),
            ('DeleteWallpaperHistory', 'OnPostDeleteWallpaperHistoryAsync(', 'DeleteWallpaperHistoryAsync('),
        ):
            self.assertIn(handler, self.view)
            self.assertIn(model_method, self.model)
            self.assertIn(store_method, self.store)

    def test_replaced_wallpapers_are_archived(self):
        self.assertIn('ArchiveCurrentWallpaper()', self.store)
        self.assertIn('Skip(10)', self.store)

    def test_latest_ddns_toolbar_handler_survives_merge(self):
        self.assertEqual(self.model.count('OnPostDdnsUpdateAllAsync('), 1)
        self.assertIn('OnPostDdnsUpdateAllAsync', self.model)
