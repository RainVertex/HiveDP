import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { yaml as yamlMode } from "@codemirror/legacy-modes/mode/yaml";
import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { PageLayout, codeMirrorTheme } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type {
  CurrentUser,
  ScaffolderTemplateDefPreview,
  ScaffolderTemplateDefRow,
} from "@internal/shared-types";
import { themeTemplates, themeWidgets } from "./rjsfTheme";
import { ActionsDocDrawer } from "./ActionsDocDrawer";

const PREVIEW_DEBOUNCE_MS = 400;

const editorExtensions = [StreamLanguage.define(yamlMode)];

const STARTER_SOURCE = `apiVersion: scaffolder.platform/v1
kind: Template
metadata:
  name: my-template
  title: My template
  description: Describe what this template provisions.
  tags:
    - service
  annotations:
    scaffolder.platform/version: 1.0.0
spec:
  type: service
  parameters:
    - title: Basic info
      required:
        - name
      properties:
        name:
          type: string
          title: Name
          description: Unique name of the component
  steps:
    - id: log
      action: debug:log
      input:
        message: Scaffolding \${{ parameters.name }}
`;

interface PreviewBoundaryProps {
  resetKey: unknown;
  fallback: string;
  children: ReactNode;
}

interface PreviewBoundaryState {
  error: Error | null;
}

class PreviewErrorBoundary extends Component<PreviewBoundaryProps, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: PreviewBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          <p>{this.props.fallback}</p>
          <p className="mt-1 font-mono">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function TemplateEditorPage() {
  const api = useApi();
  const { t } = useTranslation("scaffolder");
  const [me, setMe] = useState<CurrentUser | null | undefined>(undefined);
  const [defs, setDefs] = useState<ScaffolderTemplateDefRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<string>(STARTER_SOURCE);
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<ScaffolderTemplateDefPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [playgroundData, setPlaygroundData] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const previewSeq = useRef(0);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    api.auth
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, [api]);

  useEffect(() => {
    if (!isAdmin || defs !== null) return;
    api.scaffolder
      .listTemplateDefs()
      .then((res) => setDefs(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [api, isAdmin, defs]);

  // Live validation of the draft template.yaml plus the resolved wizard form.
  useEffect(() => {
    if (!isAdmin) return;
    const seq = ++previewSeq.current;
    const handle = setTimeout(() => {
      api.scaffolder
        .previewTemplateDef({ source })
        .then((result) => {
          if (previewSeq.current !== seq) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((err) => {
          if (previewSeq.current !== seq) return;
          setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [api, isAdmin, source]);

  function selectDef(row: ScaffolderTemplateDefRow) {
    setSelectedId(row.id);
    setSource(row.source);
    setEnabled(row.enabled);
    setPlaygroundData({});
    setNotice(null);
    setError(null);
  }

  function newDraft() {
    setSelectedId(null);
    setSource(STARTER_SOURCE);
    setEnabled(true);
    setPlaygroundData({});
    setNotice(null);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const row = selectedId
        ? await api.scaffolder.updateTemplateDef(selectedId, { source, enabled })
        : await api.scaffolder.createTemplateDef({ source });
      const refreshed = await api.scaffolder.listTemplateDefs();
      setDefs(refreshed.items);
      setSelectedId(row.id);
      setEnabled(row.enabled);
      setNotice(t("editor.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("editor.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    if (!window.confirm(t("editor.confirmDelete"))) return;
    setBusy(true);
    setError(null);
    try {
      await api.scaffolder.deleteTemplateDef(selectedId);
      const refreshed = await api.scaffolder.listTemplateDefs();
      setDefs(refreshed.items);
      newDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("editor.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (me === undefined)
    return (
      <PageLayout title={t("editor.title")}>
        <p className="text-sm text-app-text-muted">{t("loading.generic")}</p>
      </PageLayout>
    );

  if (!isAdmin)
    return (
      <PageLayout title={t("editor.title")}>
        <p className="text-sm text-app-text-muted">{t("editor.adminOnly")}</p>
      </PageLayout>
    );

  return (
    <PageLayout
      title={t("editor.title")}
      description={t("editor.description")}
      actions={
        <>
          <button
            type="button"
            onClick={() => setDocsOpen(true)}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
          >
            {t("actionsDoc.openLink")}
          </button>
          <button
            type="button"
            onClick={newDraft}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
          >
            {t("editor.newTemplate")}
          </button>
          {selectedId && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              {t("editor.delete")}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
          >
            {busy ? t("editor.saving") : t("editor.save")}
          </button>
        </>
      }
    >
      <ActionsDocDrawer open={docsOpen} onClose={() => setDocsOpen(false)} />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-3 text-sm text-emerald-700">{notice}</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <aside className="xl:col-span-3">
          <h2 className="mb-2 text-xs font-semibold uppercase text-app-text-muted">
            {t("editor.listTitle")}
          </h2>
          {defs === null && <p className="text-xs text-app-text-muted">{t("loading.generic")}</p>}
          {defs !== null && defs.length === 0 && (
            <p className="text-xs text-app-text-muted">{t("editor.emptyList")}</p>
          )}
          <ul className="space-y-1">
            {(defs ?? []).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => selectDef(row)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    row.id === selectedId
                      ? "border-app-primary bg-app-primary-soft"
                      : "border-app-border bg-app-surface hover:bg-app-surface-hover"
                  }`}
                >
                  <span className="font-mono text-xs">{row.identifier}</span>
                  {!row.enabled && (
                    <span className="ml-2 rounded bg-app-surface-hover px-1.5 py-0.5 text-[10px] text-app-text-muted">
                      {t("editor.disabledBadge")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="xl:col-span-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase text-app-text-muted">
              {t("editor.definitionLabel")}
            </h2>
            {selectedId && (
              <label className="flex items-center gap-1.5 text-xs text-app-text-muted">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                {t("editor.enabledLabel")}
              </label>
            )}
          </div>
          <div className="overflow-hidden rounded-md border border-app-border text-xs">
            <CodeMirror
              value={source}
              height="34rem"
              theme={codeMirrorTheme}
              extensions={editorExtensions}
              onChange={(value) => setSource(value)}
            />
          </div>
          {previewError && (
            <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{previewError}</p>
          )}
        </section>

        <section className="xl:col-span-4">
          <h2 className="mb-2 text-xs font-semibold uppercase text-app-text-muted">
            {t("editor.previewTitle")}
          </h2>
          {preview ? (
            <div className="rounded-md border border-app-border bg-app-surface p-4">
              <div className="mb-4 border-b border-app-border pb-3">
                <h3 className="text-base font-semibold text-app-text">{preview.title}</h3>
                <p className="mt-0.5 text-sm text-app-text-muted">{preview.description}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-app-text-muted">
                  <span className="font-mono">{preview.identifier}</span>
                  {preview.type && (
                    <span className="rounded bg-app-surface-hover px-1.5 py-0.5 text-[10px]">
                      {preview.type}
                    </span>
                  )}
                </div>
              </div>
              <PreviewErrorBoundary resetKey={preview} fallback={t("editor.previewRenderError")}>
                <Form
                  schema={preview.schema as RJSFSchema}
                  uiSchema={preview.uiSchema as UiSchema}
                  formData={playgroundData}
                  validator={validator}
                  templates={themeTemplates}
                  widgets={themeWidgets}
                  onChange={(e) => setPlaygroundData((e.formData ?? {}) as Record<string, unknown>)}
                >
                  <div className="hidden" />
                </Form>
              </PreviewErrorBoundary>
            </div>
          ) : (
            <p className="text-xs text-app-text-muted">{t("editor.previewEmpty")}</p>
          )}
        </section>
      </div>
    </PageLayout>
  );
}
