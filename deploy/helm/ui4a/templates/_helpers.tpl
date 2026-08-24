{{- define "ui4a.labels" -}}
app.kubernetes.io/instance: ui4a
app.kubernetes.io/part-of: ui4a
app.kubernetes.io/managed-by: Helm
{{- end -}}

{{- define "ui4a.hostAliases" -}}
{{- with .Values.network.hostAliases }}
hostAliases:
{{ toYaml . }}
{{- end }}
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

{{- define "ui4a.nodeContainerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsUser: 1000
runAsGroup: 1000
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "ui4a.temporalContainerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: false
runAsUser: 1000
runAsGroup: 1000
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "ui4a.nodeSelector" -}}
{{- with .Values.scheduling.nodeSelector }}
nodeSelector:
{{ toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "ui4a.productionEnv" -}}
- { name: UI4A_DEPLOYMENT_PROFILE, value: production }
- { name: UI4A_DEPLOYMENT_SETTINGS_FILE, value: /run/ui4a/settings.json }
- { name: UI4A_DEPLOYMENT_SECRETS_FILE, value: /run/secrets/ui4a-deployment-secrets }
- { name: NODE_EXTRA_CA_CERTS, value: /var/run/ui4a/trust/ca-bundle.crt }
{{- end -}}

{{- define "ui4a.productionMounts" -}}
- { name: deployment-settings, mountPath: /run/ui4a/settings.json, subPath: settings.json, readOnly: true }
- { name: deployment-secrets, mountPath: /run/secrets/ui4a-deployment-secrets, subPath: ui4a-deployment-secrets, readOnly: true }
- { name: pki-data, mountPath: /var/lib/ui4a/ca, readOnly: true }
- { name: combined-trust, mountPath: /var/run/ui4a/trust, readOnly: true }
{{- end -}}

{{- define "ui4a.productionVolumes" -}}
- name: deployment-settings
  configMap: { name: ui4a-deployment-settings }
- name: deployment-secrets
  secret: { secretName: {{ .Values.secrets.existingSecretName | quote }} }
- name: pki-data
  persistentVolumeClaim: { claimName: pki-data }
- name: panel-ca
  configMap:
    name: ui4a-panel-ca
    items: [{ key: ca.crt, path: ca.crt }]
- { name: combined-trust, emptyDir: {} }
{{- end -}}

{{- define "ui4a.trustInit" -}}
- name: trust-init
  image: {{ .image | quote }}
  imagePullPolicy: IfNotPresent
  command: [/bin/sh, -ec]
  args:
    - >-
      set -eu;
      openssl x509 -in /var/lib/ui4a/ca/root-ca.crt -noout -checkend 0;
      openssl verify -CAfile /var/lib/ui4a/ca/root-ca.crt /var/lib/ui4a/ca/root-ca.crt;
      openssl x509 -in /var/run/ui4a/panel-ca/ca.crt -noout -checkend 0;
      openssl verify -CAfile /var/run/ui4a/panel-ca/ca.crt /var/run/ui4a/panel-ca/ca.crt;
      cat /var/lib/ui4a/ca/root-ca.crt /var/run/ui4a/panel-ca/ca.crt > /var/run/ui4a/trust/ca-bundle.crt.tmp;
      chmod 0444 /var/run/ui4a/trust/ca-bundle.crt.tmp;
      mv /var/run/ui4a/trust/ca-bundle.crt.tmp /var/run/ui4a/trust/ca-bundle.crt
  volumeMounts:
    - { name: pki-data, mountPath: /var/lib/ui4a/ca, readOnly: true }
    - { name: panel-ca, mountPath: /var/run/ui4a/panel-ca, readOnly: true }
    - { name: combined-trust, mountPath: /var/run/ui4a/trust }
  resources:
    {{- include "ui4a.resources" .root | nindent 4 }}
  securityContext:
    {{- include "ui4a.nodeContainerSecurityContext" .root | nindent 4 }}
{{- end -}}

{{- define "ui4a.waitFor" -}}
- name: wait-for-{{ .dependency }}
  image: {{ default .root.Values.images.worker .image | quote }}
  imagePullPolicy: IfNotPresent
  command: [node, -e]
  args:
    - >-
      const fs=require('node:fs'),net=require('node:net'),d=process.env.UI4A_WAIT_FOR,n=process.env.UI4A_NAMESPACE,
      services={postgres:['postgres',5432],temporal:['temporal',7233],keycloak:['keycloak',8080]},sleep=()=>new Promise(r=>setTimeout(r,2000));
      async function service(x){for(;;){if(await new Promise(r=>{const s=net.createConnection({host:x[0],port:x[1]},()=>{s.destroy();r(true)});s.setTimeout(1500,()=>{s.destroy();r(false)});s.on('error',()=>r(false))}))return;await sleep()}}
      async function job(){const t=fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8'),u='https://kubernetes.default.svc/apis/batch/v1/namespaces/'+n+'/jobs/'+d;for(;;){try{const r=await fetch(u,{headers:{authorization:'Bearer '+t}}),j=r.ok?await r.json():{};if(j.status?.conditions?.some(c=>c.type==='Complete'&&c.status==='True'))return;if(j.status?.conditions?.some(c=>c.type==='Failed'&&c.status==='True'))process.exit(70)}catch{}await sleep()}}
      void(services[d]?service(services[d]):job());
  env:
    - { name: UI4A_WAIT_FOR, value: {{ .dependency | quote }} }
    - { name: UI4A_NAMESPACE, value: {{ .root.Values.namespace.name | quote }} }
    - { name: NODE_EXTRA_CA_CERTS, value: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt }
  {{- if .apiToken }}
  volumeMounts:
    - { name: dependency-api-token, mountPath: /var/run/secrets/kubernetes.io/serviceaccount, readOnly: true }
  {{- end }}
  resources:
    {{- include "ui4a.resources" .root | nindent 4 }}
  securityContext:
    {{- include "ui4a.nodeContainerSecurityContext" .root | nindent 4 }}
{{- end -}}

{{- define "ui4a.dependencyApiTokenVolume" -}}
- name: dependency-api-token
  projected:
    defaultMode: 0644
    sources:
      - serviceAccountToken: { path: token, expirationSeconds: 3600 }
      - configMap:
          name: kube-root-ca.crt
          items: [{ key: ca.crt, path: ca.crt }]
{{- end -}}
