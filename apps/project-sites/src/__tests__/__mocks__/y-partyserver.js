// Jest stub for `y-partyserver`.
//
// `y-partyserver` (and its `partyserver` dependency) ship ESM that the worker's
// `transform` (TS-only) does not compile, so any suite that imports `../index`
// pulls in `durable_objects/collab_room.ts` (`class CollabRoomDO extends YServer`)
// and dies on "Cannot use import statement outside a module" inside partyserver.
//
// CollabRoomDO is never INSTANTIATED under Jest (the collab route test mocks the
// route deps; the DO's real behaviour is exercised only at runtime), so a bare
// base class is sufficient to let `extends YServer` evaluate.
//
// `__esModule: true` so @swc/jest's interop resolves the named `YServer` import.

class YServer {}

module.exports = {
  __esModule: true,
  YServer,
};
