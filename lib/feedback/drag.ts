/**
 * Pure helpers for the two places a screenshot can arrive by drag: the
 * floating "Give feedback" button (which opens the form with the image
 * already attached) and the dropzone inside the form itself.
 *
 * They live here rather than in the components because the interesting
 * cases are all data shape — a drag exposes its `types` but not its `files`
 * until the drop, and a multi-file drag should take the first *image*
 * rather than the first file — and those are cheaper to pin down in a unit
 * test than in a browser one.
 */

/**
 * Whether a drag is carrying files at all.
 *
 * `dataTransfer.files` is deliberately empty during `dragenter`/`dragover`
 * (the browser will not hand a page the bytes it has not been dropped yet),
 * so the only thing available to decide "should I light up as a drop
 * target" is the `types` list. Checking it also keeps the widget out of the
 * way of dnd-kit's reordering drags, which carry no files.
 */
export function isFileDrag(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  // `types` is a DOMStringList in older engines, so it may have no `.includes`.
  return Array.from(transfer.types ?? []).includes('Files');
}

/**
 * The first image in a drop or a file input, or `null` if there is none.
 *
 * Dropping a folder, a `.txt`, or a Finder selection of several files is
 * normal; taking the first *image* rather than rejecting the whole drop is
 * what the user meant by dragging a screenshot over.
 */
export function firstImageFile(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}
