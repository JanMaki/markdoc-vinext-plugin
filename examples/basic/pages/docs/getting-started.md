---
title: Get started with Markdoc
description: How to get started with Markdoc on Vinext
---

# {% $markdoc.frontmatter.title %}

{% callout type="info" %}
This is a custom **callout** tag rendered by the sample schema.
{% /callout %}

The product variable is {% $product %}. Uppercased greeting: {% upper("hello") %}.

{% tag /%}

{% partial file="footer.md" /%}
