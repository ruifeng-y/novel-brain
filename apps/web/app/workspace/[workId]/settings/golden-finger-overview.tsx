'use client';

import { useEffect, useState } from 'react';
import { friendlyError } from '../../../../lib/auth-api';
import type { Entity } from '../../../../lib/entities-api';
import { loadGoldenFingers, type GoldenFinger } from '../../../../lib/worldbuilding-api';

export function GoldenFingerOverview({
  workId,
  branchId,
  entities,
}: {
  workId: string;
  branchId: string;
  entities: Entity[];
}) {
  const [items, setItems] = useState<GoldenFinger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const owners = entities.filter(
      (entity) => entity.type === 'character' || entity.type === 'power_system',
    );
    let active = true;
    setLoading(true);
    Promise.all(
      owners.map((owner) =>
        loadGoldenFingers(workId, branchId, owner.id).then((response) => response.items),
      ),
    )
      .then((groups) => {
        if (active) {
          setItems(groups.flat());
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(friendlyError(requestError));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, entities, workId]);

  return (
    <section className="confirmed-facts-panel" aria-labelledby="golden-fingers-title">
      <div className="settings-center-heading">
        <div>
          <p className="workspace-step">主角与力量体系</p>
          <h2 id="golden-fingers-title">金手指</h2>
          <p>金手指绑定在人物或力量体系档案上，记录规则、代价、限制和成长曲线。</p>
        </div>
        <div className="settings-center-count" aria-label="金手指数量">
          <strong>{items.length}</strong>
          <span>个金手指</span>
        </div>
      </div>

      {error ? (
        <p className="form-message form-message-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-list-empty">正在读取金手指…</p>
      ) : items.length === 0 ? (
        <p className="settings-list-empty">
          还没有金手指。先在人物或力量体系档案里创建归属，再补充规则和代价。
        </p>
      ) : (
        <div className="confirmed-facts-list">
          {items.map((item) => (
            <article className="confirmed-fact-row" key={item.id}>
              <div className="confirmed-fact-main">
                <div className="confirmed-fact-meta">
                  <span>{item.ownerEntity.typeLabel}</span>
                  <small>归属：{item.ownerEntity.name}</small>
                </div>
                <strong>{item.name}</strong>
                <p>规则：{item.rules.join('；') || '待补全'}</p>
                <p>代价：{item.costs.join('；') || '待补全'}</p>
                <p>限制：{item.limits.join('；') || '待补全'}</p>
                <small>
                  成长：{item.growthCurve.map((stage) => stage.stage).join(' → ') || '待补全'}
                </small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
