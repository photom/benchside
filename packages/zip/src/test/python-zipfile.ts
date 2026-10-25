/**
 * An archive written by Python 3.13.5's zipfile module (synthetic content), for REQ-ZIP-002.
 * Made with:
 *
 *   import io, sys, zipfile
 *   inner = io.BytesIO()
 *   with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
 *       z.writestr('inner.txt', 'inside ' * 20)
 *   out = sys.argv[1]
 *   with zipfile.ZipFile(out, 'w') as z:
 *       z.writestr(zipfile.ZipInfo('docs/', date_time=(2025, 1, 2, 3, 4, 6)), '')
 *       i = zipfile.ZipInfo('docs/readme.txt', date_time=(2025, 1, 2, 3, 4, 6)); i.compress_type = zipfile.ZIP_DEFLATED
 *       z.writestr(i, 'hello ' * 50)
 *       i = zipfile.ZipInfo('日本語.txt', date_time=(2025, 1, 2, 3, 4, 6))
 *       z.writestr(i, 'utf-8 name')
 *       i = zipfile.ZipInfo('inner.zip', date_time=(2025, 1, 2, 3, 4, 6)); i.compress_type = zipfile.ZIP_DEFLATED
 *       z.writestr(i, inner.getvalue())
 *       i = zipfile.ZipInfo('big.bin', date_time=(2025, 1, 2, 3, 4, 6))
 *       with z.open(i, 'w', force_zip64=True) as f:
 *           f.write(b'z64')
 *       z.comment = b'made by Python zipfile'
 */
export const PYTHON_ZIPFILE = Uint8Array.from(
  atob(
    [
      'UEsDBBQAAAAAAIMYIloAAAAAAAAAAAAAAAAFAAAAZG9jcy9QSwMEFAAAAAgAgxgiWsFIQlkMAAAALAEAAA8AAABkb2NzL3Jl',
      'YWRtZS50eHTLSM3JyVfIGCWJIAFQSwMEFAAACAAAgxgiWs1OxLAKAAAACgAAAA0AAADml6XmnKzoqp4udHh0dXRmLTggbmFt',
      'ZVBLAwQUAAAACACDGCJahwvamU4AAACAAAAACQAAAGlubmVyLnppcAvwZmYRYWBg4GCwmBkZuyzy5kseIK8HiDmBODMvL7VI',
      'r6Si5PQZ7XM+nqEnZHhEGAK8GZlEmHFrgoEGRgZkIwK8WdlAAoxAaA6kjcGKAFBLAwQtAAAAAACDGCJaVFGPDv//////////',
      'BwAUAGJpZy5iaW4BABAAAwAAAAAAAAADAAAAAAAAAHo2NFBLAQIUAxQAAAAAAIMYIloAAAAAAAAAAAAAAAAFAAAAAAAAAAAA',
      'AACAAQAAAABkb2NzL1BLAQIUAxQAAAAIAIMYIlrBSEJZDAAAACwBAAAPAAAAAAAAAAAAAACAASMAAABkb2NzL3JlYWRtZS50',
      'eHRQSwECFAMUAAAIAACDGCJazU7EsAoAAAAKAAAADQAAAAAAAAAAAAAAgAFcAAAA5pel5pys6KqeLnR4dFBLAQIUAxQAAAAI',
      'AIMYIlqHC9qZTgAAAIAAAAAJAAAAAAAAAAAAAACAAZEAAABpbm5lci56aXBQSwECLQMtAAAAAACDGCJaVFGPDgMAAAADAAAA',
      'BwAAAAAAAAAAAAAAgAEGAQAAYmlnLmJpblBLBQYAAAAABQAFABcBAABCAQAAFgBtYWRlIGJ5IFB5dGhvbiB6aXBmaWxl',
    ].join(''),
  ),
  (c) => c.charCodeAt(0),
);
