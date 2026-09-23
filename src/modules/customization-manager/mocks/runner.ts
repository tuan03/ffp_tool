import type {
  CleanOrphanAssetsInput,
  CleanOrphanAssetsOutput,
  CloneCustomizationInput,
  CloneCustomizationOutput,
  CreateCustomizationInput,
  CreateCustomizationOutput,
  CustomizationManagerRunner,
  DeleteCustomizationInput,
  DeleteCustomizationOutput,
  ReadCustomizationInput,
  ReadCustomizationOutput,
  UpdateCustomizationInput,
  UpdateCustomizationOutput,
} from "../types";
import {
  mockCleanOrphanAssetsOutput,
  mockCloneOutput,
  mockCreateOutput,
  mockCustomizationConfig,
  mockDeleteOutput,
  mockReadOutput,
  mockUpdateOutput,
} from "./data";

export function createMockCustomizationManagerRunner(): CustomizationManagerRunner {
  return {
    async read(input: ReadCustomizationInput): Promise<ReadCustomizationOutput> {
      return {
        ...mockReadOutput,
        productId: input.productId,
        customization: JSON.parse(JSON.stringify(mockCustomizationConfig)),
        trackedFileIds: [...mockReadOutput.trackedFileIds],
        warnings: [],
      };
    },

    async create(input: CreateCustomizationInput): Promise<CreateCustomizationOutput> {
      return {
        ...mockCreateOutput,
        productId: input.productId,
        trackedFileIds: [...mockCreateOutput.trackedFileIds],
        warnings: [],
      };
    },

    async update(input: UpdateCustomizationInput): Promise<UpdateCustomizationOutput> {
      return {
        ...mockUpdateOutput,
        productId: input.productId,
        deletedFileIds: input.autoCleanReplacedAssets ? ["gid://shopify/MediaImage/mock-old-1"] : [],
        warnings: [],
      };
    },

    async delete(input: DeleteCustomizationInput): Promise<DeleteCustomizationOutput> {
      return {
        ...mockDeleteOutput,
        productId: input.productId,
        deletedFileIds: input.cascadeDeleteFiles ? [...mockDeleteOutput.deletedFileIds] : [],
        warnings: [],
      };
    },

    async clone(input: CloneCustomizationInput): Promise<CloneCustomizationOutput> {
      return {
        ...mockCloneOutput,
        sourceProductId: input.sourceProductId,
        targetProductId: input.targetProductId,
      };
    },

    async cleanOrphans(input?: CleanOrphanAssetsInput): Promise<CleanOrphanAssetsOutput> {
      return {
        ...mockCleanOrphanAssetsOutput,
        isDryRun: input?.dryRun ?? false,
        deletedFileIds: input?.dryRun ? [] : [...mockCleanOrphanAssetsOutput.deletedFileIds],
      };
    },
  };
}
