import Giscus, { type Theme } from "@giscus/react";
import { useEffect, useState } from "react";

interface CommentsProps {
  lightTheme?: Theme;
  darkTheme?: Theme;
}

export default function Comments({
  lightTheme = "light",
  darkTheme = "dark",
}: CommentsProps) {
  const [theme, setTheme] = useState(() => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    return currentTheme === "dark" ? darkTheme : lightTheme;
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const currentTheme =
        document.documentElement.getAttribute("data-theme");
      setTheme(currentTheme === "dark" ? darkTheme : lightTheme);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, [darkTheme, lightTheme]);

  return (
    <div className="mt-8">
      <Giscus
        id="comments"
        repo="Deepcity/deepcity.github.io"
        repoId=""
        category="Announcements"
        categoryId=""
        mapping="pathname"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="bottom"
        theme={theme}
        lang="zh-CN"
        loading="lazy"
      />
    </div>
  );
}
