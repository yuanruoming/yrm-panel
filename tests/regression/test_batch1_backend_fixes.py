"""Source-level guards for the batch-1 backend fixes.
Behaviour is proven by tests/FileCopySmoke (large-folder listing) and the
real-browser workflow tests/e2e (login limiter, ZIP streaming).
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def source(name):
    return (ROOT / name).read_text(encoding='utf-8')


class Batch1BackendFixes(unittest.TestCase):
    def test_browse_sorts_before_truncating(self):
        service = source('YrmPanel/Services/FileManagerService.cs')
        self.assertNotIn('EnumerateFileSystemEntries(directory).Take(3000)', service)
        self.assertIn('MaxScannedEntries', service)
        self.assertIn('.ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Take(1000)', service)

    def test_zip_response_allows_synchronous_zip_writes(self):
        model = source('YrmPanel/Pages/Files.cshtml.cs')
        self.assertIn('IHttpBodyControlFeature', model)
        self.assertLess(model.index('AllowSynchronousIO = true'), model.index('Response.ContentType = "application/zip"'))

    def test_login_rate_limit_counts_only_password_submissions(self):
        program = source('YrmPanel/Program.cs')
        self.assertIn('HttpMethods.IsPost(context.Request.Method)', program)
        self.assertIn('GetNoLimiter', program)
        self.assertIn('PermitLimit = 8', program)

    def test_navigation_hot_path_uses_stale_while_revalidate_and_lean_discovery(self):
        snapshot = source('YrmPanel/Services/FilesNavigationSnapshot.cs')
        files = source('YrmPanel/Pages/Files.cshtml.cs')
        manager = source('YrmPanel/Services/FileManagerService.cs')
        # An explicit refresh and every Panel mutation must still bypass stale data.
        self.assertIn('if (!refresh)', snapshot)
        self.assertIn('public void Invalidate()', snapshot)
        self.assertIn('if (_generation == generation)', snapshot)
        # My Files discovery must not run a full per-item listing on every click.
        discover = files[files.index('private IReadOnlyList<string> DiscoverMyFiles()'):files.index('private async Task<bool> IsMyFilesEntryAsync')]
        self.assertNotIn('.Browse(', discover)
        self.assertIn('FileSystemEnumerable<string>', manager)

    def test_login_form_with_explicit_action_keeps_its_antiforgery_token(self):
        # A hand-written action attribute turns the tag helper's antiforgery off.
        view = source('YrmPanel/Pages/Account/Login.cshtml')
        self.assertIn('action="/Account/Login"', view)
        self.assertIn('asp-antiforgery="true"', view)


if __name__ == '__main__':
    unittest.main()
