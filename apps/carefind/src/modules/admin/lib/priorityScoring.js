const CONTENT_TYPE_WEIGHT = {
  text: 5,
  question: 10,
  review: 15,
  article: 20,
  visual: 25,
  premium: 30,
};

const PRIORITY_THRESHOLDS = { urgent: 100, high: 60, medium: 30, low: 0 };

export function calculatePriorityScore(item) {
  const reportCount = item.report_count || item.reports_count || 0;
  const ageHours = item.created_at
    ? Math.min((Date.now() - new Date(item.created_at).getTime()) / 3600000, 720)
    : 0;
  const contentType = item.post_type || item.type || 'text';
  const contentWeight = CONTENT_TYPE_WEIGHT[contentType] ?? 5;
  const authorViolations = item.author_violation_count || 0;

  return Math.min(Math.round(
    (reportCount * 30) +
    (ageHours * 0.5) +
    contentWeight +
    (authorViolations * 20)
  ), 500);
}

export function getPriorityLevel(score) {
  if (score >= PRIORITY_THRESHOLDS.urgent) return 'urgent';
  if (score >= PRIORITY_THRESHOLDS.high) return 'high';
  if (score >= PRIORITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getModerationItems({ reports = [], posts = [], verifications = [] }) {
  const items = [];
  const seenPostIds = new Set();

  for (const r of reports) {
    const postId = r.post_id;
    if (postId && seenPostIds.has(postId)) continue;
    if (postId) seenPostIds.add(postId);

    const reportCount = postId
      ? reports.filter(r2 => r2.post_id === postId).length
      : 1;

    const post = r.posts || posts.find(p => p.id === postId);
    const score = calculatePriorityScore({
      report_count: reportCount,
      created_at: r.created_at,
      post_type: post?.post_type || 'text',
      author_violation_count: post?.user_violation_count || 0,
    });
    items.push({
      id: postId || r.id,
      source: 'report',
      target_type: 'post',
      target_id: postId,
      title: r.reason,
      description: post?.content?.slice(0, 120) || '',
      status: r.status,
      created_at: r.created_at,
      score,
      priority: getPriorityLevel(score),
      raw: r,
    });
  }

  for (const p of posts) {
    if (seenPostIds.has(p.id)) continue;
    if (p.status === 'flagged' || p.report_count > 0) {
      seenPostIds.add(p.id);
      const score = calculatePriorityScore({
        report_count: p.report_count || 0,
        created_at: p.created_at,
        post_type: p.post_type,
        author_violation_count: p.user_violation_count || 0,
      });
      items.push({
        id: p.id,
        source: 'post',
        target_type: 'post',
        target_id: p.id,
        title: p.content?.slice(0, 60) || 'Untitled post',
        description: p.content?.slice(0, 120) || '',
        status: p.report_count > 0 ? 'flagged' : 'pending',
        created_at: p.created_at,
        score,
        priority: getPriorityLevel(score),
        raw: p,
      });
    }
  }

  for (const v of verifications) {
    if (v.status === 'pending') {
      const score = calculatePriorityScore({
        report_count: 0,
        created_at: v.created_at,
        post_type: 'text',
        author_violation_count: 0,
      });
      items.push({
        id: v.id,
        source: 'verification',
        target_type: 'user',
        target_id: v.user_id,
        title: `Verification: ${v.full_name}`,
        description: `${v.profession} — ${v.workplace || 'No workplace'}`,
        status: v.status,
        created_at: v.created_at,
        score,
        priority: getPriorityLevel(score),
        raw: v,
      });
    }
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}
