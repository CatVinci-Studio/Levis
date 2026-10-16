import { useCallback, useState } from "react";
import type { ImageNameRequest } from "./ImageNameDialog";

/** The "name this image" prompt (image naming "ask"): the image plugin
 *  awaits `requestImageName`, which resolves once ImageNameDialog closes -
 *  with the chosen stem, or null when cancelled. */
export function useImageNameRequest() {
  const [imageNameRequest, setImageNameRequest] =
    useState<ImageNameRequest | null>(null);

  const requestImageName = useCallback(
    (stem: string, extension: string) =>
      new Promise<string | null>((resolve) =>
        setImageNameRequest({ stem, extension, resolve }),
      ),
    [],
  );

  const closeImageNameDialog = useCallback((stem: string | null) => {
    setImageNameRequest((request) => {
      request?.resolve(stem);
      return null;
    });
  }, []);

  return { imageNameRequest, requestImageName, closeImageNameDialog };
}
