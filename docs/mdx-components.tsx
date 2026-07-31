import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Demo } from '@/components/playground/Demo';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    // Registered globally so a page writes <Demo> without importing it.
    Demo,
    ...components,
  };
}
