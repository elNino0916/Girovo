# `fdroid update` for scripts/fdroid-repo.mjs, on Windows too.
#
# fdroidserver's update module splits the paths glob and os.walk give it on
# "/" (the localized texts, screenshots and changelogs), which on Windows come
# with "\" and crash it. That module alone gets a glob and an os.walk that
# answer with "/" — Windows takes either — and the command runs as usual.
# Elsewhere this changes nothing.

import glob
import os
import sys
import types

import fdroidserver.update as update

if os.name == 'nt':
    def slashed(found):
        return found.replace('\\', '/')

    own_glob = types.ModuleType('glob')
    own_glob.__dict__.update(glob.__dict__)
    own_glob.glob = lambda *args, **kwargs: [slashed(p) for p in glob.glob(*args, **kwargs)]

    own_os = types.ModuleType('os')
    own_os.__dict__.update(os.__dict__)
    own_os.walk = lambda top, *args, **kwargs: (
        (slashed(root), dirs, files) for root, dirs, files in os.walk(top, *args, **kwargs)
    )

    update.glob = own_glob
    update.os = own_os

from fdroidserver.__main__ import main  # noqa: E402

sys.argv = ['fdroid', 'update', *sys.argv[1:]]
main()
