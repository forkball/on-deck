import { clientEntry, css, on, ref } from "remix/ui";

import { space } from "./shared/spacing.ts";

export type LetterboxdImportFormProps = {
  uploadHref: string;
  // Letterboxd posts `ratings`; Goodreads posts `library`.
  fieldName?: string;
  accept?: string;
  error?: string;
};

function FileUploadIcon() {
  return () => (
    <span
      mix={css({
        position: "relative",
        display: "inline-block",
        width: "40px",
        height: "40px",
      })}
    >
      <svg
        viewBox="0 0 24 24"
        width="40"
        height="40"
        mix={css({ display: "block" })}
      >
        <path
          d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
          fill="none"
          stroke="#bbb"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path
          d="M13 2v7h7"
          fill="none"
          stroke="#bbb"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      </svg>
      <span
        mix={css({
          position: "absolute",
          bottom: "-2px",
          right: "-2px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          backgroundColor: "#1c1c1c",
        })}
      >
        <svg viewBox="0 0 24 24" width="11" height="11">
          <path
            d="M12 19V5M5 12l7-7 7 7"
            fill="none"
            stroke="#fff"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}

function SmallFileIcon() {
  return () => (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      mix={css({ display: "block", flex: "0 0 auto" })}
    >
      <path
        d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
        fill="none"
        stroke="#3c3c3c"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M13 2v7h7"
        fill="none"
        stroke="#3c3c3c"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// One catalog search per title makes this a tens-of-seconds wait, so the button
// disables on submit. The <form> works as a plain POST without JS.
//
// The dropzone is a <label> wrapping a hidden file input; drag/drop re-homes the
// dropped file onto the input via a DataTransfer, so native submission works.
export const LetterboxdImportForm = clientEntry<LetterboxdImportFormProps>(
  import.meta.url,
  function LetterboxdImportForm(handle) {
    let submitting = false;
    let dragActive = false;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let inputNode: HTMLInputElement | null = null;

    function setFile(file: File | null) {
      fileName = file?.name ?? null;
      fileSize = file?.size ?? null;
      handle.update();
    }

    function clearFile() {
      if (inputNode) inputNode.value = "";
      setFile(null);
    }

    return () => {
      const { uploadHref, fieldName = "ratings", accept = ".csv", error } = handle.props;
      const formatLabel = accept
        .split(",")
        .map((ext) => ext.trim().replace(/^\./, "").toUpperCase())
        .join(" or ");

      return (
        <form
          method="post"
          action={uploadHref}
          enctype="multipart/form-data"
          mix={[
            css({ display: "flex", flexDirection: "column", gap: space[3] }),
            on("submit", () => {
              submitting = true;
              handle.update();
            }),
          ]}
        >
          {error && !submitting && (
            <p mix={css({ margin: 0, color: "#b91c1c" })}>{error}</p>
          )}

          <label
            mix={[
              css({
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: space[2],
                padding: `${space[12]} ${space[4]}`,
                border: `2px dashed ${dragActive ? "#1c1c1c" : "#ccc"}`,
                borderRadius: "8px",
                backgroundColor: dragActive ? "#f0ece4" : "transparent",
                cursor: submitting ? "default" : "pointer",
                textAlign: "center",
              }),
              on("dragover", (event) => {
                event.preventDefault();
                if (!dragActive) {
                  dragActive = true;
                  handle.update();
                }
              }),
              on("dragleave", () => {
                dragActive = false;
                handle.update();
              }),
              on("drop", (event) => {
                event.preventDefault();
                dragActive = false;
                const file = event.dataTransfer?.files?.[0];
                if (file && inputNode) {
                  const transfer = new DataTransfer();
                  transfer.items.add(file);
                  inputNode.files = transfer.files;
                  setFile(file);
                }
              }),
            ]}
          >
            <span mix={css({ display: "block", marginBottom: space[1] })}>
              <FileUploadIcon />
            </span>
            <span mix={css({ fontSize: "14px" })}>
              Drag and drop file here or{" "}
              <span mix={css({ textDecoration: "underline" })}>
                Choose file
              </span>
            </span>
            <input
              type="file"
              name={fieldName}
              accept={accept}
              required
              mix={[
                css({
                  position: "absolute",
                  width: 0,
                  height: 0,
                  opacity: 0,
                  pointerEvents: "none",
                }),
                ref((node) => {
                  inputNode = node as HTMLInputElement;
                }),
                on("change", (event) => {
                  setFile(
                    (event.target as HTMLInputElement).files?.[0] ?? null,
                  );
                }),
              ]}
            />
          </label>

          <div
            mix={css({
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#888",
            })}
          >
            <span>Supported format: {formatLabel}</span>
            <span>Maximum size: 25MB</span>
          </div>

          {fileName && (
            <div
              mix={css({
                display: "flex",
                alignItems: "center",
                gap: space[2],
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: `${space[2]} ${space[3]}`,
              })}
            >
              <SmallFileIcon />
              <div mix={css({ flex: "1 1 auto", minWidth: 0 })}>
                <div
                  mix={css({
                    fontSize: "14px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  })}
                >
                  {fileName}
                </div>
                {fileSize != null && (
                  <div mix={css({ fontSize: "12px", color: "#888" })}>
                    {formatFileSize(fileSize)}
                  </div>
                )}
              </div>
              {!submitting && (
                <button
                  type="button"
                  aria-label="Remove file"
                  mix={[
                    css({
                      flex: "0 0 auto",
                      background: "none",
                      border: "none",
                      fontSize: "16px",
                      cursor: "pointer",
                      color: "#888",
                    }),
                    on("click", clearFile),
                  ]}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          <div
            mix={css({
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            })}
          >
            <button
              type="submit"
              disabled={submitting}
              mix={css({
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: space[2],
              })}
            >
              {submitting && (
                <span
                  aria-hidden="true"
                  mix={css({
                    "@keyframes letterboxd-import-spin": {
                      from: { transform: "rotate(0deg)" },
                      to: { transform: "rotate(360deg)" },
                    },
                    display: "inline-block",
                    width: "13px",
                    height: "13px",
                    borderRadius: "50%",
                    border: "2px solid currentColor",
                    borderTopColor: "transparent",
                    animation: "letterboxd-import-spin 0.6s linear infinite",
                  })}
                />
              )}
              {submitting ? "Importing…" : "Upload and import"}
            </button>
          </div>
        </form>
      );
    };
  },
);
