{{- define "ui4a.labels" -}}
app.kubernetes.io/instance: ui4a
app.kubernetes.io/part-of: ui4a
app.kubernetes.io/managed-by: Helm
{{- end -}}

{{- define "ui4a.resources" -}}
requests:
  cpu: 100m
  memory: 128Mi
limits:
  cpu: "1"
  memory: 1Gi
{{- end -}}

{{- define "ui4a.podSecurityContext" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "ui4a.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "ui4a.nodeSelector" -}}
{{- with .Values.scheduling.nodeSelector }}
nodeSelector:
{{ toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
