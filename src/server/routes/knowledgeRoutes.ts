import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type {
  ExtractedRuleCandidate,
  ExtractKnowledgeResponse,
  KnowledgeSourceType,
} from '../../types/haven.ts';
import {
  extractRulesLocally,
  findConflictingRule,
} from '../../utils/localKnowledgeExtractor.ts';
import { extractFactsWithVertex } from '../config/vertex.ts';
import { requireHostAuth, type HostAuthRequest } from '../middleware/requireHostAuth.ts';
import {
  getServerRepository,
  type HavenServerRepository,
} from '../services/serverRepository.ts';

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface KnowledgeRoutesDeps {
  repository?: HavenServerRepository;
  authMiddleware?: RequestHandler;
}

export function createKnowledgeRouter(deps: KnowledgeRoutesDeps = {}): Router {
  const router = Router();
  const resolveRepo = () => deps.repository ?? getServerRepository();
  const auth = deps.authMiddleware ?? requireHostAuth;

  router.post(
    '/knowledge/extract',
    auth,
    pdfUpload.single('file'),
    async (req: HostAuthRequest, res) => {
      try {
        const repo = resolveRepo();
        const body: unknown = req.body;
        const fields = isRecord(body) ? body : {};

        const propertyId =
          typeof fields.propertyId === 'string' ? fields.propertyId.trim() : '';
        const rawSourceType = fields.sourceType;
        const sourceType: KnowledgeSourceType =
          rawSourceType === 'pdf_upload' || rawSourceType === 'quick_note'
            ? rawSourceType
            : 'paste_text';
        const textContent =
          typeof fields.textContent === 'string' ? fields.textContent.trim() : '';
        const uploadedFile = req.file;

        if (!propertyId) {
          res.status(400).json({ error: 'propertyId is required' });
          return;
        }

        if (sourceType === 'pdf_upload') {
          if (!uploadedFile) {
            res.status(400).json({ error: 'PDF file upload is required' });
            return;
          }
          const isPdf =
            uploadedFile.mimetype === 'application/pdf' ||
            uploadedFile.originalname.toLowerCase().endsWith('.pdf');
          if (!isPdf) {
            res.status(400).json({ error: 'Only PDF files are supported in V1' });
            return;
          }
        } else if (!textContent) {
          res.status(400).json({ error: 'textContent is required' });
          return;
        }

        const [property, existingRules] = await Promise.all([
          repo.getProperty(propertyId),
          repo.getPropertyRules(propertyId),
        ]);

        if (!property) {
          res.status(404).json({ error: 'Property not found' });
          return;
        }

        const sourceTitle =
          typeof fields.sourceTitle === 'string' && fields.sourceTitle.trim()
            ? fields.sourceTitle.trim()
            : (uploadedFile?.originalname ?? 'Imported Knowledge');

        const vertexFacts = await extractFactsWithVertex({
          propertyName: property.name,
          textContent: textContent || undefined,
          pdfBuffer: uploadedFile?.buffer,
        });

        let candidates: ExtractedRuleCandidate[];
        let source: 'vertex' | 'local_fallback';

        if (vertexFacts && vertexFacts.length > 0) {
          source = 'vertex';
          candidates = vertexFacts.map((fact, idx) => {
            const conflict = findConflictingRule(fact.topic, fact.value, existingRules);
            return {
              id: `vertex-cand-${Date.now()}-${idx}`,
              topic: fact.topic,
              value: fact.value,
              category: fact.category,
              sourceLabel: sourceTitle,
              conflictRuleId: conflict?.id ?? null,
              existingValue: conflict?.value ?? null,
            };
          });
        } else {
          source = 'local_fallback';
          if (sourceType === 'pdf_upload' && uploadedFile) {
            const rawHeader = uploadedFile.buffer.subarray(0, 16).toString('ascii').trimStart();
            if (rawHeader.startsWith('%PDF-')) {
              res.status(503).json({
                error:
                  'Binary PDF extraction requires Vertex AI credentials. Paste rule text directly in local mode.',
              });
              return;
            }
          }
          const fallbackText =
            textContent ||
            (uploadedFile
              ? uploadedFile.buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ').trim()
              : '');
          candidates = fallbackText.length >= 6
            ? extractRulesLocally(fallbackText, sourceTitle, existingRules)
            : [];
        }

        const payload: ExtractKnowledgeResponse = {
          sourceTitle,
          sourceType,
          candidates,
          source,
        };
        res.json(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to extract knowledge';
        res.status(500).json({ error: message });
      }
    },
  );

  return router;
}
