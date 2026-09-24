// In-memory file system. Starts empty — use Open Folder, Upload, or Open GitHub Repo.
// Each top-level entry in fileSystem is a workspace (folder / repo / uploads).
// Only the active workspace renders; toggle via the workspace switcher.
// Depends on: nothing.
// Defines: fileSystem, activeFileId, activeWorkspaceId.

var fileSystem = [];

var activeFileId = null;

var activeWorkspaceId = null;
