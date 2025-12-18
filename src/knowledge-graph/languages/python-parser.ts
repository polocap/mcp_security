import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { logger } from '../../utils/logger.js';
import type { LanguageParser, ExtractedElement, ExtractedEdge } from '../ast-parser.js';
import { traverseTree, getNodeText } from '../ast-parser.js';

const pyLogger = logger.child('python-parser');

function extractPythonNodes(tree: Parser.Tree, filePath: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<string>();

  // Add module node for the file itself
  elements.push({
    type: 'module',
    name: filePath,
    lineStart: 1,
    lineEnd: tree.rootNode.endPosition.row + 1,
    metadata: { isEntryPoint: filePath.includes('__main__') || filePath.includes('main.py') },
  });

  traverseTree(tree.rootNode, (node) => {
    // Function definitions
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = getNodeText(nameNode);
        const key = `function:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Check for decorators
          const decorators: string[] = [];
          let prevSibling = node.previousNamedSibling;
          while (prevSibling && prevSibling.type === 'decorator') {
            decorators.push(getNodeText(prevSibling));
            prevSibling = prevSibling.previousNamedSibling;
          }

          // Check for async
          const isAsync = node.children.some((c) => c.type === 'async');

          // Get parameters
          const params = node.childForFieldName('parameters');
          const paramNames: string[] = [];
          if (params) {
            traverseTree(params, (p) => {
              if (p.type === 'identifier' && p.parent?.type !== 'default_parameter') {
                paramNames.push(getNodeText(p));
              }
            });
          }

          elements.push({
            type: 'function',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              async: isAsync,
              decorators,
              parameters: paramNames,
              isMethod: node.parent?.type === 'block' && node.parent.parent?.type === 'class_definition',
            },
          });
          pyLogger.debug(`Found function: ${name} at line ${node.startPosition.row + 1}`);
        }
      }
    }

    // Class definitions
    if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = getNodeText(nameNode);
        const key = `class:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Get base classes
          const baseClasses: string[] = [];
          const superclassNode = node.childForFieldName('superclasses');
          if (superclassNode) {
            traverseTree(superclassNode, (c) => {
              if (c.type === 'identifier') {
                baseClasses.push(getNodeText(c));
              }
            });
          }

          // Get decorators
          const decorators: string[] = [];
          let prevSibling = node.previousNamedSibling;
          while (prevSibling && prevSibling.type === 'decorator') {
            decorators.push(getNodeText(prevSibling));
            prevSibling = prevSibling.previousNamedSibling;
          }

          elements.push({
            type: 'class',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              baseClasses,
              decorators,
            },
          });
          pyLogger.debug(`Found class: ${name} with bases: ${baseClasses.join(', ')}`);
        }
      }
    }

    // Import statements
    if (node.type === 'import_statement') {
      const moduleNode = node.namedChildren[0];
      if (moduleNode) {
        const moduleName = getNodeText(moduleNode);
        const key = `import:${moduleName}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          elements.push({
            type: 'import',
            name: moduleName,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              importType: 'import',
            },
          });
          pyLogger.debug(`Found import: ${moduleName}`);
        }
      }
    }

    // From imports
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name');
      if (moduleNode) {
        const moduleName = getNodeText(moduleNode);
        const key = `import:${moduleName}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Get imported names
          const importedNames: string[] = [];
          traverseTree(node, (c) => {
            if (c.type === 'dotted_name' && c !== moduleNode) {
              importedNames.push(getNodeText(c));
            } else if (c.type === 'aliased_import') {
              const name = c.childForFieldName('name');
              if (name) importedNames.push(getNodeText(name));
            }
          });

          elements.push({
            type: 'import',
            name: moduleName,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              importType: 'from',
              importedNames,
            },
          });
          pyLogger.debug(`Found from import: from ${moduleName} import ${importedNames.join(', ')}`);
        }
      }
    }

    // Global variables (assignments at module level)
    if (node.type === 'assignment' && node.parent?.type === 'module') {
      const left = node.childForFieldName('left');
      if (left && left.type === 'identifier') {
        const name = getNodeText(left);
        const key = `variable:${name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          elements.push({
            type: 'variable',
            name,
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            metadata: {
              isConstant: name === name.toUpperCase(),
            },
          });
        }
      }
    }
  });

  pyLogger.info(`Extracted ${elements.length} elements from ${filePath}`);
  return elements;
}

function extractPythonEdges(tree: Parser.Tree, nodes: ExtractedElement[], filePath: string): ExtractedEdge[] {
  const edges: ExtractedEdge[] = [];
  let currentFunction: string | null = null;
  let currentClass: string | null = null;

  traverseTree(tree.rootNode, (node) => {
    // Track current class
    if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        currentClass = getNodeText(nameNode);

        // Add inheritance edges
        const superclassNode = node.childForFieldName('superclasses');
        if (superclassNode) {
          traverseTree(superclassNode, (c) => {
            if (c.type === 'identifier') {
              edges.push({
                sourceRef: currentClass!,
                targetRef: getNodeText(c),
                type: 'inherits',
                metadata: {},
              });
            }
          });
        }
      }
    }

    // Track current function
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        currentFunction = getNodeText(nameNode);
      }
    }

    // Function calls
    if (node.type === 'call') {
      const funcNode = node.childForFieldName('function');
      if (funcNode && currentFunction) {
        let calleeName = getNodeText(funcNode);

        // Handle attribute access (obj.method())
        if (funcNode.type === 'attribute') {
          const attr = funcNode.childForFieldName('attribute');
          if (attr) {
            calleeName = getNodeText(attr);
          }
        }

        if (calleeName) {
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

    // Import edges
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      const moduleNode = node.type === 'import_statement'
        ? node.namedChildren[0]
        : node.childForFieldName('module_name');
      if (moduleNode) {
        edges.push({
          sourceRef: filePath,
          targetRef: getNodeText(moduleNode),
          type: 'imports',
          metadata: {
            line: node.startPosition.row + 1,
          },
        });
      }
    }
  });

  pyLogger.info(`Extracted ${edges.length} edges from ${filePath}`);
  return edges;
}

export const pythonParser: LanguageParser = {
  language: 'python',
  extensions: ['.py', '.pyw'],
  parser: Python as unknown as Parser.Language,
  extractNodes: extractPythonNodes,
  extractEdges: extractPythonEdges,
};
