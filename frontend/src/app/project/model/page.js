"use client";
import { AlertTriangle, ArrowRight, Database, FlaskConical, Scale, Target } from "lucide-react";
import { Card, Stat, PageHeader, Spinner, ErrorBox, Table, BarList, Badge } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";

const f3 = (v) => Number(v).toFixed(3);
const pctf = (v) => `${(Number(v) * 100).toFixed(1)}%`;

const STEPS = [
  ["Wallet & loan features", "age, activity, tier, loans repaid / defaulted"],
  ["Monotonic gradient boosting", "250 shallow trees, direction-constrained"],
  ["Platt calibration", "safeguard; changes P by under 0.003"],
  ["P(default)", "clipped to 2%–98%"],
  ["Credit score", "(1 − P) × 1000"],
  ["Dynamic APR", "25% → 5%"],
];

export default function ModelCard() {
  const { data: d, loading, error, reload } = useAsync(() => api.get("/analytics/model"), []);
  if (loading) return <div className="pt-24"><Spinner label="Loading model card" /></div>;
  if (error) return <div className="mx-auto max-w-3xl px-4 pt-28"><ErrorBox error={error} onRetry={reload} /></div>;
  const m = d.metrics;
  const t = m?.final_test?.calibrated;
  const op = m?.operating_point;
  const real = d.realBenchmark;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="AI risk model: model card" subtitle={`${d.algorithm} · version ${d.model}`} />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100" role="note">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p><b>Read this first.</b> Credloom has not launched, so no real wallet-default data exists. The deployed model is trained on a <b>synthetic, documented dataset</b>. Its metrics show how well the pipeline recovers a known risk process under noise, <b>not</b> real-world default prediction. The algorithm choice is separately checked on a real public dataset (below).</p>
      </div>

      {d.legacyFallback && <div className="mb-6"><ErrorBox error={new Error("The v2 model is not trained yet: serving the legacy model, which has no published metrics. Run mlModel/training/train.py.")} /></div>}

      <Card title="How a score is produced">
        <ol className="flex flex-wrap items-stretch gap-2">
          {STEPS.map(([a, b], i) => (
            <li key={a} className="flex items-center gap-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3"><p className="text-sm font-medium text-white">{a}</p><p className="text-xs text-zinc-400">{b}</p></div>
              {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-zinc-600" aria-hidden />}
            </li>
          ))}
        </ol>
      </Card>

      {m && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="ROC AUC (held-out test)" value={f3(t.roc_auc)} hint="0.5 = coin flip, 1.0 = perfect" icon={Target} tone="info" />
            <Stat label="KS statistic" value={f3(t.ks)} hint="credit-industry separation measure" icon={Scale} />
            <Stat label="Brier score" value={f3(t.brier)} hint="probability error (lower is better)" icon={FlaskConical} />
            <Stat label="PR AUC" value={f3(t.pr_auc)} hint={`baseline ${f3(m.dataset.default_rate)} (default rate)`} icon={Database} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Dataset" subtitle={m.dataset.synthetic ? "Synthetic (generator documented in the repo)" : "Custom"}>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[["Wallets", m.dataset.rows.toLocaleString()], ["Default rate", pctf(m.dataset.default_rate)], ["Train / validation / test", `${m.dataset.train.toLocaleString()} / ${m.dataset.validation.toLocaleString()} / ${m.dataset.test.toLocaleString()}`], ["Features", d.features.length]].map(([k, v]) => (<div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>))}
              </dl>
              <p className="mt-4 text-xs text-zinc-500">Test data was used exactly once, after every choice (model, calibration, threshold) was fixed on train and validation data.</p>
            </Card>
            <Card title="At the chosen operating point" subtitle={`Flag as high-risk when P(default) ≥ ${op.threshold_chosen_on_validation.toFixed(2)} (chosen on validation data)`}>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[["Precision", pctf(op.test_metrics.precision)], ["Recall", pctf(op.test_metrics.recall)], ["F1", f3(op.test_metrics.f1)], ["Accuracy", pctf(op.test_metrics.accuracy)]].map(([k, v]) => (<div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>))}
              </dl>
              <p className="mt-4 text-xs text-zinc-500">Accuracy alone is misleading with {pctf(m.dataset.default_rate)} defaults: always predicting “no default” scores {pctf(1 - m.dataset.default_rate)}. That is why AUC, KS and calibration are reported.</p>
            </Card>
          </div>

          <Card className="mt-6" title="Does the score actually rank risk?" subtitle="Observed default rate by credit-score band on the test set. A useful score falls steadily as the band rises.">
            <BarList format={(v) => `${v.toFixed(1)}% default`} color="bg-red-400"
              items={Object.entries(m.score_bands_test).map(([band, v]) => ({ label: `Score ${band} · ${v.wallets} wallets`, value: v.observed_default_rate * 100 }))} />
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Why repayment history matters" subtitle="Ablation on the validation set (same model, different inputs)" pad={false}>
              <div className="p-2"><Table rows={Object.entries(m.feature_ablation_validation).map(([k, v]) => ({ id: k, k, auc: v.roc_auc, ks: v.ks }))} columns={[
                { key: "k", label: "Inputs", render: (r) => r.k }, { key: "auc", label: "AUC", right: true, render: (r) => f3(r.auc) }, { key: "ks", label: "KS", right: true, render: (r) => f3(r.ks) }]} /></div>
              <p className="px-5 pb-4 text-xs text-zinc-500">The original model saw only wallet activity and tier. Adding loans repaid / defaulted is the largest single gain.</p>
            </Card>
            <Card title="Which algorithm?" subtitle="5-fold cross-validated AUC on the synthetic training split" pad={false}>
              <div className="p-2"><Table rows={Object.entries(m.model_comparison_cv).map(([k, v]) => ({ id: k, k, v }))} columns={[
                { key: "k", label: "Model", render: (r) => r.k }, { key: "a", label: "CV AUC", right: true, render: (r) => `${f3(r.v.cv_auc_mean)} ± ${f3(r.v.cv_auc_std)}` }]} /></div>
              <p className="px-5 pb-4 text-xs text-zinc-500">Models are statistically tied here because the synthetic process is close to linear. This table alone does not justify boosting; the real-data check below does.</p>
            </Card>
          </div>
        </>
      )}

      {real && (
        <Card className="mt-6" title="Real-data check of the algorithm choice" subtitle={`${real.dataset.name}: ${real.dataset.rows.toLocaleString()} real customers, ${pctf(real.dataset.default_rate)} defaulted. Different features, so this validates the method, not the deployed model.`} pad={false}>
          <div className="p-2"><Table rows={Object.entries(real.models).map(([k, v]) => ({ id: k, k, v }))} columns={[
            { key: "k", label: "Model", render: (r) => r.k }, { key: "cv", label: "CV AUC", right: true, render: (r) => `${f3(r.v.cv_auc)} ± ${f3(r.v.cv_auc_std)}` },
            { key: "t", label: "Test AUC", right: true, render: (r) => f3(r.v.test_auc) }, { key: "pr", label: "PR AUC", right: true, render: (r) => f3(r.v.test_pr_auc) }, { key: "b", label: "Brier", right: true, render: (r) => f3(r.v.test_brier) }]} /></div>
          <p className="px-5 pb-4 text-xs text-zinc-500">On real data, tree ensembles beat logistic regression by about 7 AUC points, which supports the Gradient Boosting choice.</p>
        </Card>
      )}

      {m && (
        <Card className="mt-6" title="Evaluation plots" subtitle="ROC curves, calibration before/after Platt scaling, permutation importance (test set)">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/model/evaluation.png" alt="ROC curves for four models, calibration curves, and permutation feature importance" className="w-full rounded-lg bg-white" />
        </Card>
      )}

      <Card className="mt-6" title="Known limitations">
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
          <li>Synthetic training labels: real-world accuracy is unknown until real repayment data exists. The pipeline retrains on any CSV with the same columns.</li>
          <li>The generator assumes a thin wallet is only mildly riskier, to avoid excluding newcomers. That is a design choice, not a measured fact.</li>
          <li>Scores are clipped to 20–980 so the model never claims certainty.</li>
          <li>Calibration is applied but is nearly a no-op here: the boosted model was already well calibrated (largest change 0.003, identical Brier score).</li>
          <li>Monotonic constraints guarantee a score can never fall because a wallet repaid a loan, verified, or became more active, and never rise after a default. Wallet age and borrowed volume have small effects by design.</li>
          <li>On-chain behaviour can be gamed (e.g. many small self-loans). Tier verification and the on-chain default flag are the mitigations; Sybil resistance is not solved.</li>
          <li>No fairness audit has been run.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2"><Badge>Reproduce: mlModel/training/generate_dataset.py</Badge><Badge>mlModel/training/train.py</Badge><Badge>mlModel/training/real_benchmark.py</Badge></div>
      </Card>
    </div>
  );
}
