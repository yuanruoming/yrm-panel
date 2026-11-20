"""File library is a view of real home/data directories, not a manual registry."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding='utf-8')
class MyFilesContracts(unittest.TestCase):
    def test_my_files_is_automatically_discovered(self):
        handler=source('YrmPanel/Pages/Files.cshtml.cs')
        view=source('YrmPanel/Pages/Files.cshtml')
        self.assertIn('MyFiles = DiscoverMyFiles();',handler)
        self.assertIn('roots.AddRange(MountedVolumes.Select',handler)
        self.assertIn('roots.Add(System.IO.Path.TrimEndingDirectorySeparator(home));',handler)
        self.assertIn('var browse = _files.Browse(',handler)
        self.assertIn('foreach (var old in _folders.List())',handler)
        self.assertNotIn('Add to My Folders',view)
        self.assertNotIn('My Folders',view)
        self.assertNotIn('<th>Location</th>',view)
    def test_mounted_volumes_and_real_folder_ops_kept(self):
        handler=source('YrmPanel/Pages/Files.cshtml.cs')
        view=source('YrmPanel/Pages/Files.cshtml')
        self.assertIn('asp-route-path="@relative"',view)
        self.assertIn('asp-page-handler="DeleteLibrary"',view)
        self.assertIn('asp-page-handler="Unshare"',view)
        self.assertIn('asp-page-handler="PinFolder"',view)
        self.assertIn('IsMyFilesEntryAsync(absolute)',handler)
        self.assertIn('AssertNoSharesAsync(absolute)',handler)
    def test_no_duplicate_files_page_heading(self):
        view=source('YrmPanel/Pages/Files.cshtml')
        self.assertNotIn('<h1>Files',view)
        self.assertIn('class="fm-location-crumb">My Files',view)
        self.assertNotIn('class="fm-locations-heading">FILES',view)
        self.assertIn('data-my-files-toggle',view)
if __name__=='__main__':unittest.main()
