import type { AnchorHTMLAttributes } from 'react';
import { routeHref } from './navigation';
export default function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} href={href.startsWith('/') ? routeHref(href) : href} onClick={(event) => {
    props.onClick?.(event);
    if (href.startsWith('/') && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && props.target !== '_blank') {
      event.preventDefault(); location.hash = href; window.scrollTo(0, 0);
    }
  }}>{children}</a>;
}
