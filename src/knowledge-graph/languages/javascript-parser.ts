import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import { logger } from '../../utils/logger.js';
import type { LanguageParser, ExtractedElement, ExtractedEdge } from '../ast-parser.js';
import { traverseTree, getNodeText } from '../ast-parser.js';
import type { NodeType, EdgeType } from '../../types/graph.js';

const jsLogger = logger.child('js-parser');

function extractJsNodes(tree: Parser.Tree, filePath: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<string>();

  // Add module node for the file itself
  elements.push({
    type: 'module',
    name: filePath,
    lineStart: 1,
    lineEnd: tree.rootNode.endPosition.row + 1,
    metadata: { isEntryPoint: filePath.includes('index') },
  });

  traverseTree(tree.rootNode, (node) => {
    // Function declarations
    if (node.type === 'function_declaration' || node.type === 'function') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = getNodeText(nameNode);
        const key = `function:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          elements.push({
            type: 'function',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              async: node.children.some((c) => c.type === 'async'),
              generator: node.children.some((c) => c.type === '*'),
              exported: isExported(node),
            },
          });
          jsLogger.debug(`Found function: ${name} at line ${node.startPosition.row + 1}`);
        }
      }
    }

    // Arrow functions assigned to variables
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (nameNode && valueNode && valueNode.type === 'arrow_function') {
        const name = getNodeText(nameNode);
        const key = `function:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          elements.push({
            type: 'function',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              arrowFunction: true,
              async: valueNode.children.some((c) => c.type === 'async'),
              exported: isExported(node.parent?.parent),
            },
          });
          jsLogger.debug(`Found arrow function: ${name} at line ${node.startPosition.row + 1}`);
        }
      }
    }

    // Class declarations
    if (node.type === 'class_declaration' || node.type === 'class') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = getNodeText(nameNode);
        const key = `class:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Find superclass
          const heritageNode = node.childForFieldName('heritage');
          let superclass: string | undefined;
          if (heritageNode) {
            superclass = getNodeText(heritageNode).replace('extends ', '').trim();
          }

          elements.push({
            type: 'class',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              exported: isExported(node),
              superclass,
            },
          });
          jsLogger.debug(`Found class: ${name} at line ${node.startPosition.row + 1}`);
        }
      }
    }

    // Import statements
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const source = getNodeText(sourceNode).replace(/['"]/g, '');
        const key = `import:${source}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Extract imported names
          const importedNames: string[] = [];
          traverseTree(node, (child) => {
            if (child.type === 'import_specifier' || child.type === 'identifier') {
              if (child.parent?.type === 'import_clause' || child.parent?.type === 'import_specifier') {
                importedNames.push(getNodeText(child));
              }
            }
          });

          elements.push({
            type: 'import',
            name: source,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              importedNames,
              isDefault: node.text.includes('import ') && !node.text.includes('{'),
              isNamespace: node.text.includes('* as'),
            },
          });
          jsLogger.debug(`Found import: ${source} at line ${node.startPosition.row + 1}`);
        }
      }
    }

    // Export statements
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const nameNode = declaration.childForFieldName('name');
        if (nameNode) {
          const name = getNodeText(nameNode);
          const key = `export:${name}:${node.startPosition.row}`;
          if (!seen.has(key)) {
            seen.add(key);
            elements.push({
              type: 'export',
              name,
              lineStart: node.startPosition.row + 1,
              lineEnd: node.endPosition.row + 1,
              metadata: {
                isDefault: node.text.includes('export default'),
              },
            });
          }
        }
      }
    }

    // Variables and constants
    if (node.type === 'variable_declaration') {
      const kind = node.children[0]?.type; // const, let, var
      for (const declarator of node.children) {
        if (declarator.type === 'variable_declarator') {
          const nameNode = declarator.childForFieldName('name');
          const valueNode = declarator.childForFieldName('value');
          if (nameNode && valueNode?.type !== 'arrow_function' && valueNode?.type !== 'function') {
            const name = getNodeText(nameNode);
            const key = `variable:${name}:${node.startPosition.row}`;
            if (!seen.has(key)) {
              seen.add(key);
              elements.push({
                type: 'variable',
                name,
                lineStart: node.startPosition.row + 1,
                lineEnd: node.endPosition.row + 1,
                metadata: {
                  kind,
                  exported: isExported(node),
                },
              });
            }
          }
        }
      }
    }
  });

  jsLogger.info(`Extracted ${elements.length} elements from ${filePath}`);
  return elements;
}

function extractJsEdges(tree: Parser.Tree, nodes: ExtractedElement[], filePath: string): ExtractedEdge[] {
  const edges: ExtractedEdge[] = [];
  const functionNames = new Set(nodes.filter((n) => n.type === 'function').map((n) => n.name));
  const classNames = new Set(nodes.filter((n) => n.type === 'class').map((n) => n.name));

  // Track current scope for call edges
  let currentFunction: string | null = null;

  traverseTree(tree.rootNode, (node) => {
    // Track current function scope
    if (node.type === 'function_declaration' || node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        currentFunction = getNodeText(nameNode);
      }
    }

    // Function calls
    if (node.type === 'call_expression') {
      const calleeNode = node.childForFieldName('function');
      if (calleeNode) {
        let calleeName = getNodeText(calleeNode);
        // Handle member expressions like obj.method()
        if (calleeNode.type === 'member_expression') {
          const property = calleeNode.childForFieldName('property');
          if (property) {
            calleeName = getNodeText(property);
          }
        }

        if (currentFunction && calleeName) {
          edges.push({
            sourceRef: currentFunction,
            targetRef: calleeName,
            type: 'calls',
            metadata: {
              line: node.startPosition.row + 1,
            },
          });
        }
      }
    }

    // Class inheritance
    if (node.type === 'class_declaration' || node.type === 'class') {
      const nameNode = node.childForFieldName('name');
      const heritageNode = node.childForFieldName('heritage');
      if (nameNode && heritageNode) {
        const className = getNodeText(nameNode);
        const superclass = getNodeText(heritageNode).replace('extends ', '').trim().split(' ')[0];
        if (superclass) {
          edges.push({
            sourceRef: className,
            targetRef: superclass,
            type: 'inherits',
            metadata: {},
          });
          jsLogger.debug(`Found inheritance: ${className} extends ${superclass}`);
        }
      }
    }

    // Import edges (module imports another)
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const source = getNodeText(sourceNode).replace(/['"]/g, '');
        edges.push({
          sourceRef: filePath,
          targetRef: source,
          type: 'imports',
          metadata: {
            line: node.startPosition.row + 1,
          },
        });
      }
    }
  });

  jsLogger.info(`Extracted ${edges.length} edges from ${filePath}`);
  return edges;
}

function isExported(node: Parser.SyntaxNode | null | undefined): boolean {
  if (!node) return false;
  if (node.type === 'export_statement') return true;
  return node.parent ? isExported(node.parent) : false;
}

export const javascriptParser: LanguageParser = {
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  parser: JavaScript as unknown as Parser.Language,
  extractNodes: extractJsNodes,
  extractEdges: extractJsEdges,
};

export const typescriptParser: LanguageParser = {
  language: 'typescript',
  extensions: ['.ts', '.tsx'],
  parser: TypeScript.typescript as unknown as Parser.Language,
  extractNodes: extractJsNodes,
  extractEdges: extractJsEdges,
};
