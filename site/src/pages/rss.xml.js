import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
	const wpisy = (await getCollection('blog', ({ data }) => !data.szkic))
		.sort((a, b) => b.data.data.valueOf() - a.data.data.valueOf());

	return rss({
		title: 'Notatki — Kamil Krzywoń',
		description: 'Notatki techniczne: uczenie maszynowe, Python, systemy produkcyjne.',
		site: context.site,
		stylesheet: '/rss/styles.xsl',
		customData: '<language>pl-pl</language>',
		items: wpisy.map((w) => ({
			title: w.data.title,
			description: w.data.opis,
			pubDate: w.data.data,
			link: `/blog/${w.id}/`,
		})),
	});
}
