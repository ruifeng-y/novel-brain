import Link from 'next/link';
import type { OutlineNode } from '../../../../lib/story-planning-api';

export function OutlineBoard({
  nodes,
  workId,
}: {
  nodes: OutlineNode[];
  workId: string;
}) {
  const volumes = nodes
    .filter((node) => node.level === 'volume')
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return (
    <section className="outline-board-view" aria-labelledby="outline-board-title">
      <div className="works-section-heading">
        <div>
          <p className="workspace-step">按卷推进</p>
          <h2 id="outline-board-title">章节看板</h2>
        </div>
        <span>{volumes.length} 卷</span>
      </div>
      {volumes.length === 0 ? (
        <p className="dashboard-empty">还没有卷。先在结构树里建立全书和第一卷。</p>
      ) : (
        <div className="outline-board-columns">
          {volumes.map((volume) => {
            const acts = nodes
              .filter((node) => node.level === 'act' && node.parentId === volume.id)
              .sort((left, right) => left.orderIndex - right.orderIndex);
            return (
              <section className="outline-board-column" key={volume.id}>
                <h3>{volume.title}</h3>
                <p>{volume.summary || '还没有卷摘要'}</p>
                {acts.length === 0 ? (
                  <small>还没有幕</small>
                ) : (
                  acts.map((act) => {
                    const chapters = nodes
                      .filter((node) => node.level === 'chapter' && node.parentId === act.id)
                      .sort((left, right) => left.orderIndex - right.orderIndex);
                    return (
                      <div className="outline-board-act" key={act.id}>
                        <h4>{act.title}</h4>
                        {chapters.map((chapter) => (
                          <Link
                            className="outline-board-card"
                            href={`/workspace/${workId}/write?chapter=${chapter.chapterNumber ?? ''}`}
                            key={chapter.id}
                          >
                            <span>第 {chapter.chapterNumber ?? '—'} 章</span>
                            <strong>{chapter.title}</strong>
                            <small>{chapter.chapterGoal || chapter.summary || '还没有章目标'}</small>
                          </Link>
                        ))}
                      </div>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
