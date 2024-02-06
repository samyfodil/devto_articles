import fs from "fs-extra";
import path from "path";
import { unified } from "unified";
import markdown from "remark-parse";
import stringify from "remark-stringify";
import frontmatter from "remark-frontmatter";
import yaml from "yaml";
import { visit } from "unist-util-visit";
import { run } from "@mermaid-js/mermaid-cli";

async function processMarkdown(imagesRoot, filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const dir = path.resolve(imagesRoot);
  const fileNameWithoutExt = path.basename(filePath, ".md");
  const assetsDir = path.resolve("./posts/assets", fileNameWithoutExt);
  await fs.ensureDir(assetsDir);

  const processor = unified()
    .use(markdown)
    .use(frontmatter, ["yaml", "toml"])
    .use(stringify, {
      bullet: "*",
      fence: "`",
      fences: true,
      incrementListMarker: false,
    });

  const mdAst = processor.parse(content);

  // Modify the YAML front matter
  mdAst.children.forEach((node) => {
    if (node.type === "yaml") {
      let frontMatter = yaml.parse(node.value);

      // Check and copy the cover image if specified
      if (frontMatter.image && frontMatter.image.src) {
        let coverImageSrc = frontMatter.image.src.startsWith("/")
          ? path.join(dir, frontMatter.image.src.slice(1))
          : path.join(dir, frontMatter.image.src);
        const imageName = path.basename(coverImageSrc);
        frontMatter.cover_image = `./assets/${fileNameWithoutExt}/${imageName}`; // Update cover_image path
        const targetPath = path.resolve(assetsDir, imageName);
        fs.copy(coverImageSrc, targetPath).catch(console.error); // Copy cover image
      }

      // Transform the original YAML front matter to the required format
      frontMatter = {
        title: frontMatter.title || "Example article title",
        published: false,
        description: frontMatter.snippet || "A simple test article",
        tags: (frontMatter.tags || []).join(", "),
        cover_image: `./assets/${fileNameWithoutExt}/${path.basename(
          frontMatter.image?.src || ""
        )}`,
      };
      node.value = yaml.stringify(frontMatter);

      // Copy the cover image if specified
      if (frontMatter.image?.src) {
        const imagePath = frontMatter.image.src.startsWith("/")
          ? path.join(dir, frontMatter.image.src.slice(1))
          : path.join(dir, frontMatter.image.src);
        const imageName = path.basename(imagePath);
        const targetPath = path.resolve(assetsDir, imageName);
        fs.copy(imagePath, targetPath).catch(console.error);
      }
    }
  });

  let mermaidIndex = 0;
  const mermaidPromises = [];

  visit(mdAst, "image", (node) => {
    const imagePath = node.url.startsWith("/")
      ? path.join(dir, node.url.slice(1))
      : path.join(dir, node.url);
    const imageName = path.basename(imagePath);
    node.url = `./assets/${fileNameWithoutExt}/${imageName}`;
    const targetPath = path.resolve(assetsDir, imageName);
    fs.copy(imagePath, targetPath).catch(console.error);
  });

  visit(mdAst, "code", (node, index, parent) => {
    if (node.lang === "mermaid") {
      const diagramName = `diagram-${mermaidIndex++}.png`;
      const inputPath = path.resolve(assetsDir, `temp-${diagramName}.mmd`);
      const outputPath = path.resolve(assetsDir, diagramName);

      const promise = fs
        .writeFile(inputPath, node.value)
        .then(() =>
          run(inputPath, outputPath, { backgroundColor: "transparent" })
        )
        .then(() => fs.unlink(inputPath))
        .then(() => {
          const imageNode = {
            type: "paragraph",
            children: [
              {
                type: "image",
                url: `./assets/${fileNameWithoutExt}/${diagramName}`,
                title: null,
                alt: `Mermaid diagram ${diagramName}`,
              },
            ],
          };
          parent.children.splice(index, 1, imageNode);
        })
        .catch(console.error);

      mermaidPromises.push(promise);
    }
  });

  await Promise.all(mermaidPromises);

  const newContent = processor.stringify(mdAst);
  const newFilePath = path.resolve("./posts", `${fileNameWithoutExt}.md`);
  await fs.writeFile(newFilePath, newContent, "utf8");
}

const [, , imagesRoot, mdFilePath] = process.argv;
if (!imagesRoot || !mdFilePath) {
  console.error("Usage: npm run import <root of images> <path to md file>");
  process.exit(1);
}

processMarkdown(imagesRoot, mdFilePath).catch(console.error);
