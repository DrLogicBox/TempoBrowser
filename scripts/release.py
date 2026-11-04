import hashlib
import json
from pathlib import Path
import zipfile


root = Path(__file__).resolve().parent.parent
runtime = root / 'TempoBrowser-win32-x64'
output = root / 'release'
output.mkdir(exist_ok=True)
private_summary = root / 'evidence/verification-summary.json'
if private_summary.exists():
    summary = json.loads(private_summary.read_text(encoding='utf-8'))
    if not summary['passed'] or not summary['protectedUnchanged']:
        raise RuntimeError('Local verification must complete before release')
if not (runtime / 'TempoBrowser.exe').is_file():
    raise RuntimeError('Run npm run build before packaging')
for filename in (root / 'src').iterdir():
    if filename.is_file() and filename.read_bytes() != (runtime / 'resources/app/src' / filename.name).read_bytes():
        raise RuntimeError('Packaged application differs from source ' + filename.name)

binary = output / 'TempoBrowser-beta-1-win-x64.zip'
source = output / 'TempoBrowser-beta-1-source.zip'
excluded_runtime = {'user-data', 'Downloads', '验证资料', '方案.md', '验证报告.md'}
with zipfile.ZipFile(binary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for filename in sorted(runtime.rglob('*')):
        relative = filename.relative_to(runtime)
        if filename.is_file() and relative.parts[0] not in excluded_runtime and not relative.parts[0].startswith('test-profile'):
            archive.write(filename, Path(runtime.name) / relative)
    archive.write(root / 'docs/verification.md', Path(runtime.name) / '验证报告.md')

source_items = ['src', 'tests', 'scripts', 'docs', 'assets', 'package.json', 'package-lock.json',
                'README.md', 'LICENSE', '.gitignore', '.gitattributes']
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for item in source_items:
        target = root / item
        files = sorted(target.rglob('*')) if target.is_dir() else [target]
        for filename in files:
            if filename.is_file() and '__pycache__' not in filename.parts and filename.suffix != '.pyc':
                archive.write(filename, Path('TempoBrowser-beta1-source') / filename.relative_to(root))

checksums = []
for filename in [binary, source]:
    with zipfile.ZipFile(filename) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError('Archive contains duplicate entries')
        bad = archive.testzip()
        if bad:
            raise RuntimeError('Archive checksum failed for ' + bad)
        if filename == binary:
            if any('/user-data/' in name or '/test-profile' in name or '/Downloads/' in name for name in names):
                raise RuntimeError('Personal data must be excluded')
    digest = hashlib.sha256(filename.read_bytes()).hexdigest()
    checksums.append(digest + '  ' + filename.name)
    print(json.dumps({'file': str(filename), 'bytes': filename.stat().st_size, 'sha256': digest}))
(output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
