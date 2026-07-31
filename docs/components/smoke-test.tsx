import { LayoutNode, computeLayout } from 'bento-layout';

// Temporary: proves the `bento-layout` -> ../src alias resolves and the engine
// runs inside Next. Delete once a real playground component replaces it.
export function SmokeTest() {
  const a = LayoutNode.make({ flexGrow: 1 });
  const b = LayoutNode.make({ flexGrow: 1 });
  const root = LayoutNode.make({ width: 400, height: 120, columnGap: 10 }, [a, b]);
  computeLayout(root, { width: 'max-content', height: 'max-content' });

  const boxes = [a, b].map((n) => n.layout);

  return (
    <div className="relative h-[120px] w-[400px] rounded border border-fd-border">
      {boxes.map((box, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center bg-fd-primary/10 text-xs"
          style={{
            left: box.location.x,
            top: box.location.y,
            width: box.size.width,
            height: box.size.height,
          }}
        >
          {box.size.width} × {box.size.height}
        </div>
      ))}
    </div>
  );
}
