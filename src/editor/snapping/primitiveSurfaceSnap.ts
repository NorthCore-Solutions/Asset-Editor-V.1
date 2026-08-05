import type { PrimitiveType } from '../../types/editor';

export type {
  ObjectSurfaceSnapResult as FormSurfaceSnapResult,
  SurfaceSnapTarget
} from './objectSurfaceSnap';

export {
  findObjectSurfaceSnap,
  findObjectSurfaceSnap as findFormSurfaceSnap,
  snapObjectToObjectSurfaces,
  snapObjectToObjectSurfaces as snapFormToFormSurfaces,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject
} from './objectSurfaceSnap';

/**
 * Kompatibilitätsfunktion für bestehende Viewport-Aufrufstellen.
 * Oberflächen-Snap ist nicht mehr auf eine feste Typenliste begrenzt.
 */
export const isFormType = (type: PrimitiveType): boolean => {
  void type;
  return true;
};
