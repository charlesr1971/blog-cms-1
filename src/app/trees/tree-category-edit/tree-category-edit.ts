import { SelectionModel } from '@angular/cdk/collections';
import { FlatTreeControl } from '@angular/cdk/tree';
import { Component, Injectable, ViewChild } from '@angular/core';
import { MatTreeFlatDataSource, MatTreeFlattener } from '@angular/material/tree';
import { BehaviorSubject, Observable } from 'rxjs';
import { DeviceDetectorService } from 'ngx-device-detector';

import { PathFormatPipe } from '../../pipes/path-format/path-format.pipe';
import { EmptyDirectoryFormatPipe } from '../../pipes/empty-directory-format/empty-directory-format.pipe';
import { ConvertPathToIdPipe } from '../../pipes/convert-path-to-id/convert-path-to-id.pipe';
import { ConvertIdToPathPipe } from '../../pipes/convert-id-to-path/convert-id-to-path.pipe';
import { HttpService } from '../../services/http/http.service';

/**
 * Node for to-do item
 */
export class TodoItemNode {
  children: TodoItemNode[];
  item: string;
  empty: number;
  path: string;
  id: string;
  isDeleted: boolean;
  opacity: number;
}

/** Flat to-do item node with expandable and level information */
export class TodoItemFlatNode {
  item: string;
  level: number;
  expandable: boolean;
  empty: number;
  path: string;
  id: string;
  isDeleted: boolean;
  opacity: number;
}

/**
 * Checklist database, it can build a tree structured Json object.
 * Each node in Json object represents a to-do item or a category.
 * If a node is a category, it has children items and new items can be added under the category.
 */
@Injectable()
export class ChecklistDatabase {

  dataChange = new BehaviorSubject<TodoItemNode[]>([]);

  dataMap = {};
  http: Observable<any>;
  httpService;

  debug: boolean = false;
  
  get data(): TodoItemNode[] { return this.dataChange.value; }

  constructor(httpService: HttpService,
    private convertIdToPathPipe: ConvertIdToPathPipe,
    private pathFormatPipe: PathFormatPipe,
    private emptyDirectoryFormatPipe: EmptyDirectoryFormatPipe,
    private convertPathToIdPipe: ConvertPathToIdPipe) {
      
    this.httpService = httpService;
    this.fetchData();

  }

  fetchData(): void {
    this.http = this.httpService.fetchDirectoryTree(true,true,true).subscribe( (data: any) => {
      if(data) {
        this.dataMap['categories'] = data;
        if(this.debug) {
          console.log(this.dataMap);
        }
        this.initialize();
      }
    });
  }


  initialize() {
    // Build the tree nodes from Json object. The result is a list of `TodoItemNode` with nested
    //     file node as children.
    const data = this.buildFileTree(this.dataMap, 0);

    // Notify the change.
    this.dataChange.next(data);
  }

  /**
   * Build the file structure tree. The `value` is the Json object, or a sub-tree of a Json object.
   * The return value is the list of `TodoItemNode`.
   */
  buildFileTree(obj: {[key: string]: any}, level: number): TodoItemNode[] {
    return Object.keys(obj).reduce<TodoItemNode[]>((accumulator, key) => {

      const value = obj[key];
      const node = new TodoItemNode();

      node.item = this.pathFormatPipe.transform(key);
      node.empty = this.emptyDirectoryFormatPipe.transform(key);
      if(node.item === 'categories') {
        node.empty = 0;
      }
      node.path = key;
      node.id = this.pathFormatPipe.transform(this.convertPathToIdPipe.transform(key));
      node.isDeleted = false;
      node.opacity = 1;

      if (value != null) {
        if (typeof value === 'object') {
          node.children = this.buildFileTree(value, level + 1);
        } else {
          node.item = this.pathFormatPipe.transform(value);
          node.empty = this.emptyDirectoryFormatPipe.transform(value);
          if(node.item === 'categories') {
            node.empty = 0;
          }
          node.path = value;
          node.id = this.pathFormatPipe.transform(this.convertPathToIdPipe.transform(value));
          node.isDeleted = false;
          node.opacity = 1;
        }
      }

      return accumulator.concat(node);
    }, []);
  }

  /** Add an item to to-do list */
  insertItem(parent: TodoItemNode, name: string) {
    if (parent.children) {
      parent.children.push({item: name} as TodoItemNode);
      this.dataChange.next(this.data);
    }
  }

  updateItem(node: TodoItemNode, name: string, id: string) {
    node.item = name;
    node.empty = 1;
    node.path = this.updateName(name,id) + '^' + node.empty;
    node.id = this.pathFormatPipe.transform(this.convertPathToIdPipe.transform(node.path));
    if(typeof node.isDeleted === 'undefined') {
      node.isDeleted = false;
    }
    if(typeof node.opacity === 'undefined') {
      node.opacity = 1;
    }
    if(this.debug) {
      console.log('checklistDatabase: updateItem(): name: ',name);
      console.log('checklistDatabase: updateItem(): id: ',id);
      console.log('checklistDatabase: updateItem(): this.data: ',this.data);
    }
    this.dataChange.next(this.data);
  }

  isDeletedItem(node: TodoItemNode, value: boolean) {
    node.isDeleted = value;
    node.opacity = value ? 0.5 : 1;
    if(this.debug) {
      console.log('checklistDatabase: isDeletedItem(): this.data: ',this.data);
    }
    this.dataChange.next(this.data);
  }

  updateName(name: string, id: string): string {
    const regex = new RegExp('_[0-9]+$');
    let _id = id.replace(regex,'');
    let str = _id.split('-');
    if(!regex.test(id)) {
      str.pop();
    }
    str.push(name);
    let result = str.join('//');
    return result;
  }

}

/**
 * @title Tree with checkboxes
 */
@Component({
  selector: 'app-tree-category-edit',
  templateUrl: 'tree-category-edit.html',
  styleUrls: ['tree-category-edit.css'],
  providers: [ChecklistDatabase, PathFormatPipe, EmptyDirectoryFormatPipe, ConvertPathToIdPipe]
})
export class TreeCategoryEdit {

  //@ViewChild('treeSelector') tree: any;

  /** Map from flat node to nested node. This helps us finding the nested node to be modified */
  flatNodeMap = new Map<TodoItemFlatNode, TodoItemNode>();

  /** Map from nested node to flattened node. This helps us to keep the same object for selection */
  nestedNodeMap = new Map<TodoItemNode, TodoItemFlatNode>();

  /** A selected parent node to be inserted */
  selectedParent: TodoItemFlatNode | null = null;

  /** The new item's name */
  newItemName = '';

  treeControl: FlatTreeControl<TodoItemFlatNode>;

  treeFlattener: MatTreeFlattener<TodoItemNode, TodoItemFlatNode>;

  dataSource: MatTreeFlatDataSource<TodoItemNode, TodoItemFlatNode>;

  /** The selection for checklist */
  checklistSelection = new SelectionModel<TodoItemFlatNode>(true /* multiple */);

  newNodeId: string = '';
  isMobile: boolean = false;
  disableTreeCategoryEditTooltip: boolean = false;

  debug: boolean = false;

  constructor(private database: ChecklistDatabase,
    private deviceDetectorService: DeviceDetectorService,
    private pathFormatPipe: PathFormatPipe,
    private emptyDirectoryFormatPipe: EmptyDirectoryFormatPipe,
    private convertPathToIdPipe: ConvertPathToIdPipe) {

    this.isMobile = this.deviceDetectorService.isMobile();

    if(this.isMobile) {
      this.disableTreeCategoryEditTooltip = true;
    }


    this.treeFlattener = new MatTreeFlattener(this.transformer, this.getLevel,
      this.isExpandable, this.getChildren);
    this.treeControl = new FlatTreeControl<TodoItemFlatNode>(this.getLevel, this.isExpandable);
    this.dataSource = new MatTreeFlatDataSource(this.treeControl, this.treeFlattener);

    database.dataChange.subscribe(data => {
      this.dataSource.data = data;
      if(this.treeControl && data.length > 0) {
        ;
        if(this.debug) {
          console.log('treeCategoryEdit.component: database.dataChange: this.treeControl.dataNodes: ',this.treeControl.dataNodes);
        }
        if(this.treeControl.dataNodes.length > 0) {
          this.treeControl.dataNodes.map( (node) => {
            let item = data.map(function(element) {
              if (element['id'].toLowerCase() === node['id'].toLowerCase()) {
                node.opacity = element['opacity'];
              }
            });
            //if(this.debug) {
              //console.log('treeCategoryEdit.component: database.dataChange: item: ',item);
            //}
            /* if('opacity' in item) {
              const opacity = item['opacity'];
              node.opacity = opacity;
            } */
          });
        }
      }
      if(this.debug) {
        console.log('treeCategoryEdit.component: database.dataChange: data: ',data);
      }
    });

  }

  getLevel = (node: TodoItemFlatNode) => node.level;

  getEmpty = (node: TodoItemFlatNode) => node.empty;

  isExpandable = (node: TodoItemFlatNode) => node.expandable;

  getChildren = (node: TodoItemNode): TodoItemNode[] => node.children;

  hasChild = (_: number, _nodeData: TodoItemFlatNode) => _nodeData.expandable;

  hasNoContent = (_: number, _nodeData: TodoItemFlatNode) => _nodeData.item === '';

  /**
   * Transformer to convert nested node to flat node. Record the nodes in maps for later use.
   */
  transformer = (node: TodoItemNode, level: number) => {
    const existingNode = this.nestedNodeMap.get(node);
    const flatNode = existingNode && existingNode.item === node.item
        ? existingNode
        : new TodoItemFlatNode();

    flatNode.item = node.item;
    flatNode.level = level;
    flatNode.empty = node.empty;
    flatNode.path = node.path;
    flatNode.id = node.id;
    flatNode.isDeleted = false;
    flatNode.opacity = 1;

    flatNode.expandable = !!node.children;
    this.flatNodeMap.set(flatNode, node);
    this.nestedNodeMap.set(node, flatNode);
    return flatNode;
  }

  /** Whether all the descendants of the node are selected. */
  descendantsAllSelected(node: TodoItemFlatNode): boolean {
    const descendants = this.treeControl.getDescendants(node);
    const descAllSelected = descendants.every( (child) =>
      {
        return this.checklistSelection.isSelected(child);
      }
    );
    return descAllSelected;
  }

  /** Whether part of the descendants are selected */
  descendantsPartiallySelected(node: TodoItemFlatNode): boolean {
    const descendants = this.treeControl.getDescendants(node);
    const result = descendants.some( (child) => {
      return this.checklistSelection.isSelected(child);
    });
    return result && !this.descendantsAllSelected(node);
  }

  /** Toggle the to-do item selection. Select/deselect all the descendants node */
  todoItemSelectionToggle(node: TodoItemFlatNode): void {
    this.checklistSelection.toggle(node);
    const descendants = this.treeControl.getDescendants(node);
    this.checklistSelection.isSelected(node)
      ? this.checklistSelection.select(...descendants)
      : this.checklistSelection.deselect(...descendants);

    // Force update for the parent
    descendants.every( (child) => {
        return this.checklistSelection.isSelected(child);
      }
    );
    descendants.map( (child) => {
      this.isDeletedNode(child,this.checklistSelection.isSelected(child));
    });
    this.checkAllParentsSelection(node);

  }

  /** Toggle a leaf to-do item selection. Check all the parents to see if they changed */
  todoLeafItemSelectionToggle(node: TodoItemFlatNode): void {
    this.checklistSelection.toggle(node);
    this.checkAllParentsSelection(node);
  }

  /* Checks all the parents when a leaf node is selected/unselected */
  checkAllParentsSelection(node: TodoItemFlatNode): void {
    let parent: TodoItemFlatNode | null = this.getParentNode(node);
    while (parent) {
      this.checkRootNodeSelection(parent);
      parent = this.getParentNode(parent);
    }
  }

  /** Check root node checked state and change it accordingly */
  checkRootNodeSelection(node: TodoItemFlatNode): void {
    const nodeSelected = this.checklistSelection.isSelected(node);
    const descendants = this.treeControl.getDescendants(node);
    const descAllSelected = descendants.every( (child) => {
        return this.checklistSelection.isSelected(child);
      }
    );
    if (nodeSelected && !descAllSelected) {
      this.checklistSelection.deselect(node);
    } else if (!nodeSelected && descAllSelected) {
      this.checklistSelection.select(node);
    }
    descendants.map( (child) => {
      this.isDeletedNode(child,this.checklistSelection.isSelected(child));
    });
  }

  /* Get the parent node of a node */
  getParentNode(node: TodoItemFlatNode): TodoItemFlatNode | null {
    const currentLevel = this.getLevel(node);

    if (currentLevel < 1) {
      return null;
    }

    const startIndex = this.treeControl.dataNodes.indexOf(node) - 1;

    for (let i = startIndex; i >= 0; i--) {
      const currentNode = this.treeControl.dataNodes[i];

      if (this.getLevel(currentNode) < currentLevel) {
        return currentNode;
      }
    }
    return null;
  }

  getRandomInt(min: number = 1000000, max: number = 9999999): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  /** Select the category so we can insert the new item. */
  addNewItem(node: TodoItemFlatNode) {
    const parentNode = this.flatNodeMap.get(node);
    this.database.insertItem(parentNode!, '');
    this.createNodeId(node);
    this.treeControl.expand(node);
  }

  /** Save the node to database */
  saveNode(node: TodoItemFlatNode, itemValue: string) {
    const nestedNode = this.flatNodeMap.get(node);
    let nodeid = node.id;
    if(this.debug) {
      console.log('treeCategoryEdit.component: saveNode(): node: ',node);
      console.log('treeCategoryEdit.component: saveNode(): nodeid: before: ',nodeid);
      console.log('treeCategoryEdit.component: saveNode(): nestedNode: ',nestedNode);
    }
    if(!nodeid || (nodeid && nodeid === '')) {
      nodeid = this.newNodeId;
    }
    else{
      this.newNodeId = '';
    }
    if(this.debug) {
      console.log('treeCategoryEdit.component: saveNode(): nodeid: after: ',nodeid);
    }
    this.database.updateItem(nestedNode!, itemValue, nodeid);
  }

  /** Mark the node as 'isDeleted' to database */
  isDeletedNode(node: TodoItemFlatNode, itemValue: boolean) {
    const nestedNode = this.flatNodeMap.get(node);
    if(this.debug) {
      console.log('treeCategoryEdit.component: isDeletedNode(): node: ',node);
      console.log('treeCategoryEdit.component: isDeletedNode(): itemValue: ',itemValue);
      console.log('treeCategoryEdit.component: isDeletedNode(): nestedNode: ',nestedNode);
    }
    this.database.isDeletedItem(nestedNode!, itemValue);
    //this.flatNodeMap.get(node).opacity = itemValue ? 1 : 0.5;
  }

  createNodeId(node: TodoItemFlatNode) {
    const id = node.id + '_' + this.getRandomInt();
    if(this.debug) {
      console.log('treeCategoryEdit.component: createNodeId(): node: ',node);
      console.log('treeCategoryEdit.component: createNodeId(): id: ',id);
    }
    this.newNodeId = id;
  }

  treeCategoryEditSubmit(): void {

  }

}