import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import type { IChangeEvent } from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type { ScaffolderTemplateDetail } from "@internal/api-client";
import type { CatalogEntityWithOwners } from "@internal/shared-types";
import { TemplateDriftBadge } from "./TemplateDriftBadge";

const FORM_STATE_DEBOUNCE_MS = 300;

export function TemplatePage() {
  const { templateId } = useParams<{ templateId: string }>();
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation("scaffolder");
  const [template, setTemplate] = useState<ScaffolderTemplateDetail | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [uiSchema, setUiSchema] = useState<Record<string, unknown>>({});
  const [entities, setEntities] = useState<CatalogEntityWithOwners[] | null>(null);
  const [entityId, setEntityId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formStateSeq = useRef(0);

  useEffect(() => {
    if (!templateId) return;
    api.scaffolder
      .getTemplate(templateId)
      .then((tpl) => {
        setTemplate(tpl);
        setSchema(tpl.parametersJsonSchema);
        setUiSchema(tpl.uiSchema ?? {});
      })
      .catch((err) => setError(err.message ?? t("errors.loadTemplate")));
  }, [api, templateId, t]);

  const needsEntity = template !== null && template.operation !== "create";

  useEffect(() => {
    if (!needsEntity || entities !== null) return;
    api.catalog
      .list()
      .then((res) => setEntities(res.items))
      .catch(() => setEntities([]));
  }, [api, needsEntity, entities]);

  // Re-resolves jqQuery dynamic fields server-side as the form changes.
  useEffect(() => {
    if (!template) return;
    const seq = ++formStateSeq.current;
    const handle = setTimeout(() => {
      api.scaffolder
        .formState(template.id, {
          formData,
          ...(entityId ? { catalogEntityId: entityId } : {}),
        })
        .then((state) => {
          if (formStateSeq.current !== seq) return;
          setSchema(state.schema);
          setUiSchema(state.uiSchema ?? {});
        })
        .catch(() => {
          // Keep the last resolved schema when the resolve call fails.
        });
    }, FORM_STATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [api, template, formData, entityId]);

  async function handleSubmit(e: IChangeEvent<Record<string, unknown>>) {
    if (!template) return;
    setError(null);
    setSubmitting(true);
    try {
      const plan = await api.scaffolder.createPlan({
        templateId: template.id,
        params: e.formData ?? {},
        ...(entityId ? { catalogEntityId: entityId } : {}),
      });
      navigate(`/scaffolder/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.createPlan"));
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !template)
    return (
      <PageLayout title={t("page.createTitle")}>
        <p className="text-sm text-red-600">{error}</p>
      </PageLayout>
    );
  if (!template || !schema)
    return (
      <PageLayout title={t("page.createTitle")}>
        <p className="text-sm text-app-text-muted">{t("loading.generic")}</p>
      </PageLayout>
    );

  const planBlocked = needsEntity && !entityId;

  return (
    <PageLayout
      title={template.name}
      description={template.description}
      actions={<TemplateDriftBadge templateId={template.id} />}
    >
      <div className="max-w-2xl">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {template.requiredApproval && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
            {t("form.requiredApprovalNote")}
          </p>
        )}
        {needsEntity && (
          <div className="mb-4">
            <label htmlFor="scaffolder-entity" className="mb-1 block text-xs text-app-text-muted">
              {t("form.entityLabel")}
            </label>
            <select
              id="scaffolder-entity"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm"
            >
              <option value="">{t("form.entityPlaceholder")}</option>
              {(entities ?? []).map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name} ({entity.kind})
                </option>
              ))}
            </select>
          </div>
        )}
        <Form
          schema={schema as RJSFSchema}
          uiSchema={uiSchema as UiSchema}
          formData={formData}
          validator={validator}
          onChange={(e) => setFormData((e.formData ?? {}) as Record<string, unknown>)}
          onSubmit={handleSubmit}
          disabled={submitting}
        >
          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting || planBlocked}
              className="rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-app-primary-on disabled:opacity-50"
            >
              {submitting ? t("form.planningLabel") : t("form.plan")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/scaffolder")}
              className="rounded-md border border-app-border px-4 py-2 text-sm text-app-text-muted hover:bg-app-surface-hover"
            >
              {t("form.cancel")}
            </button>
          </div>
        </Form>
      </div>
    </PageLayout>
  );
}
